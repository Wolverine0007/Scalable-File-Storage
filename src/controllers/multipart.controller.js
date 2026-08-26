const crypto = require("crypto");
const db = require("../config/db");

const {
    initiateMultipartUpload,
    generatePartUploadUrl,
    completeMultipartUpload,
    getFileMetadata
} = require("../services/s3.service");


// ========================================
// INITIATE MULTIPART UPLOAD
// ========================================

async function initiateUpload(req, res) {

    try {

        const userId = req.user.userId;

        const {
            fileName,
            mimeType,
            fileSize
        } = req.body;


        // Basic validation
        if (!fileName || !mimeType || !fileSize) {

            return res.status(400).json({
                success: false,
                message:
                    "fileName, mimeType and fileSize are required"
            });

        }


        // Generate unique file ID
        const fileId =
            crypto.randomUUID();


        // User-specific S3 key
        const key =
            `users/${userId}/${fileId}-${fileName}`;


        // Initiate multipart upload in S3
        const result =
            await initiateMultipartUpload(
                key,
                mimeType
            );


        // Calculate number of parts
        const totalParts =
            Math.ceil(
                Number(fileSize) /
                (5 * 1024 * 1024)
            );


        // Save upload session
        await db.query(
            `
            INSERT INTO upload_sessions
            (
                user_id,
                upload_id,
                s3_key,
                file_name,
                file_size,
                mime_type,
                total_parts,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                userId,
                result.uploadId,
                result.key,
                fileName,
                fileSize,
                mimeType,
                totalParts,
                "initiated"
            ]
        );


        res.status(200).json({

            success: true,

            uploadId:
                result.uploadId,

            key:
                result.key,

            fileName,

            fileSize,

            mimeType,

            totalParts

        });


    } catch (error) {

        console.error(
            "Multipart initiate error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to initiate multipart upload"

        });

    }
}


// ========================================
// GENERATE PART URLS
// ========================================

async function generatePartUrls(req, res) {

    try {

        const userId =
            req.user.userId;

        const {
            uploadId
        } = req.body;


        if (!uploadId) {

            return res.status(400).json({
                success: false,
                message: "uploadId is required"
            });

        }


        // Get upload session
        const [sessions] =
            await db.query(
                `
                SELECT *
                FROM upload_sessions
                WHERE upload_id = ?
                  AND user_id = ?
                `,
                [
                    uploadId,
                    userId
                ]
            );


        if (sessions.length === 0) {

            return res.status(404).json({
                success: false,
                message:
                    "Upload session not found"
            });

        }


        const session =
            sessions[0];


        // Do not generate URLs for completed upload
        if (
            session.status ===
            "completed"
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Upload is already completed"
            });

        }


        const key =
            session.s3_key;

        const totalParts =
            session.total_parts;


        // Change status to uploading
        await db.query(
            `
            UPDATE upload_sessions
            SET status = 'uploading'
            WHERE upload_id = ?
              AND user_id = ?
            `,
            [
                uploadId,
                userId
            ]
        );


        const partUrls = [];


        for (
            let partNumber = 1;
            partNumber <= totalParts;
            partNumber++
        ) {

            const url =
                await generatePartUploadUrl(
                    key,
                    uploadId,
                    partNumber
                );


            partUrls.push({

                partNumber,

                url

            });

        }


        res.json({

            success: true,

            uploadId,

            key,

            totalParts,

            partUrls

        });


    } catch (error) {

        console.error(
            "Generate part URLs error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to generate part upload URLs"

        });

    }
}


// ========================================
// COMPLETE MULTIPART UPLOAD
// ========================================

async function completeUpload(req, res) {

    try {

        const userId =
            req.user.userId;

        const {
            uploadId,
            key,
            parts
        } = req.body;


        if (
            !uploadId ||
            !key ||
            !parts
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "uploadId, key and parts are required"
            });

        }


        // Security check
        if (
            !key.startsWith(
                `users/${userId}/`
            )
        ) {

            return res.status(403).json({
                success: false,
                message:
                    "Unauthorized upload key"
            });

        }


        // Find upload session
        const [sessions] =
            await db.query(
                `
                SELECT *
                FROM upload_sessions
                WHERE upload_id = ?
                  AND user_id = ?
                `,
                [
                    uploadId,
                    userId
                ]
            );


        if (sessions.length === 0) {

            return res.status(404).json({
                success: false,
                message:
                    "Upload session not found"
            });

        }


        const session =
            sessions[0];


        // Prevent duplicate completion
        if (
            session.status ===
            "completed"
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Upload is already completed"
            });

        }


        // Verify key belongs to session
        if (
            session.s3_key !== key
        ) {

            return res.status(403).json({
                success: false,
                message:
                    "Invalid upload key"
            });

        }


        // Complete multipart upload in S3
        const result =
            await completeMultipartUpload(
                key,
                uploadId,
                parts
            );


        // Get metadata from S3
        const metadata =
            await getFileMetadata(
                key
            );


        // Use filename from database
        const fileName =
            session.file_name;


        // Save final file metadata
        const sql = `
            INSERT INTO files
            (
                user_id,
                file_name,
                file_size,
                mime_type,
                s3_key,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `;


        const [dbResult] =
            await db.query(
                sql,
                [
                    userId,
                    fileName,
                    metadata.fileSize,
                    metadata.mimeType,
                    key,
                    "completed"
                ]
            );


        // Mark upload session completed
        await db.query(
            `
            UPDATE upload_sessions
            SET status = 'completed'
            WHERE upload_id = ?
              AND user_id = ?
            `,
            [
                uploadId,
                userId
            ]
        );


        res.status(200).json({

            success: true,

            message:
                "Multipart upload completed successfully",

            file: {

                id:
                    dbResult.insertId,

                fileName,

                fileSize:
                    metadata.fileSize,

                mimeType:
                    metadata.mimeType,

                s3Key:
                    key,

                status:
                    "completed"

            },

            s3: {

                location:
                    result.Location,

                etag:
                    result.ETag

            }

        });


    } catch (error) {

        console.error(
            "Complete multipart upload error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to complete multipart upload"

        });

    }
}

async function recordUploadedPart(req, res) {

    try {

        // Make sure authentication middleware ran
        if (!req.user) {

            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });

        }

        const userId = req.user.userId;

        const {
            uploadId,
            partNumber,
            etag
        } = req.body;


        // Basic validation
        if (!uploadId || !partNumber || !etag) {

            return res.status(400).json({
                success: false,
                message:
                    "uploadId, partNumber and etag are required"
            });

        }


        // Find upload session belonging to this user
        const [sessions] = await db.query(
            `
            SELECT id
            FROM upload_sessions
            WHERE upload_id = ?
              AND user_id = ?
            `,
            [uploadId, userId]
        );


        if (sessions.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Upload session not found"
            });

        }


        const uploadSessionId =
            sessions[0].id;


        // Store uploaded part
        await db.query(
            `
            INSERT INTO upload_parts
            (
                upload_session_id,
                part_number,
                etag
            )
            VALUES (?, ?, ?)

            ON DUPLICATE KEY UPDATE
                etag = VALUES(etag),
                status = 'uploaded'
            `,
            [
                uploadSessionId,
                partNumber,
                etag
            ]
        );


        res.status(200).json({

            success: true,

            message:
                "Part recorded successfully",

            partNumber,

            etag

        });


    } catch (error) {

        console.error(
            "Record uploaded part error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to record uploaded part"

        });

    }
}

async function getUploadProgress(req, res) {

    try {

        const userId = req.user.userId;

        const { uploadId } = req.params;


        if (!uploadId) {

            return res.status(400).json({
                success: false,
                message: "uploadId is required"
            });

        }


        // Find upload session
        const [sessions] = await db.query(
            `
            SELECT
                id,
                upload_id,
                s3_key,
                file_name,
                file_size,
                mime_type,
                total_parts,
                status
            FROM upload_sessions
            WHERE upload_id = ?
              AND user_id = ?
            `,
            [uploadId, userId]
        );


        if (sessions.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Upload session not found"
            });

        }


        const session = sessions[0];


        // Get already uploaded parts
        const [parts] = await db.query(
            `
            SELECT
                part_number,
                etag,
                status
            FROM upload_parts
            WHERE upload_session_id = ?
              AND status = 'uploaded'
            ORDER BY part_number ASC
            `,
            [session.id]
        );


        res.status(200).json({

            success: true,

            uploadId: session.upload_id,

            key: session.s3_key,

            fileName: session.file_name,

            fileSize: session.file_size,

            mimeType: session.mime_type,

            totalParts: session.total_parts,

            status: session.status,

            uploadedParts: parts

        });


    } catch (error) {

        console.error(
            "Get upload progress error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Failed to get upload progress"

        });

    }
}


module.exports = {
    initiateUpload,
    generatePartUrls,
    recordUploadedPart,
    getUploadProgress,
    completeUpload
};