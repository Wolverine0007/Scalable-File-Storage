const {
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    HeadObjectCommand
} = require("@aws-sdk/client-s3");



const {
    getSignedUrl
} = require("@aws-sdk/s3-request-presigner");

const s3 = require("../config/s3");


const BUCKET = process.env.AWS_S3_BUCKET;


async function uploadFile(fileBuffer, key, mimeType) {

    const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType
    });

    await s3.send(command);

    return key;
}


async function generateDownloadUrl(key, fileName) {

    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ResponseContentDisposition:
            `attachment; filename="${fileName}"`
    });

    const url = await getSignedUrl(
        s3,
        command,
        {
            expiresIn: 900
        }
    );

    return url;
}


async function deleteFile(key) {

    const command = new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key
    });

    await s3.send(command);
}


async function initiateMultipartUpload(key, mimeType) {

    const command = new CreateMultipartUploadCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: mimeType
    });

    const response = await s3.send(command);

    return {
        uploadId: response.UploadId,
        key: response.Key
    };
}

async function generatePartUploadUrl(key, uploadId, partNumber) {

    const command = new UploadPartCommand({
        Bucket: BUCKET,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber
    });

    const url = await getSignedUrl(
        s3,
        command,
        {
            expiresIn: 900
        }
    );

    return url;
}

async function completeMultipartUpload(
    key,
    uploadId,
    parts
) {

    const command =
        new CompleteMultipartUploadCommand({

            Bucket: BUCKET,

            Key: key,

            UploadId: uploadId,

            MultipartUpload: {
                Parts: parts
            }

        });

    const response =
        await s3.send(command);

    return response;
}

async function getFileMetadata(key) {

    const command = new HeadObjectCommand({
        Bucket: BUCKET,
        Key: key
    });

    const response = await s3.send(command);

    return {
        fileSize: response.ContentLength,
        mimeType: response.ContentType
    };
}


module.exports = {
    uploadFile,
    generateDownloadUrl,
    deleteFile,
    initiateMultipartUpload,
    generatePartUploadUrl,
    completeMultipartUpload,
    getFileMetadata
};