require("dotenv").config();
const TOKEN = process.env.UPLOAD_TOKEN;

const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const axios = require("axios");



// Maximum number of retries for a failed part
const MAX_RETRIES = 3;

// Delay before retrying
const RETRY_DELAY = 1000;


const API_BASE_URL =
    process.env.API_BASE_URL || "http://localhost:3000";


// ========================================
// CONFIGURATION
// ========================================

const FILE_PATH =
    path.join(__dirname, "../test-files/large-test.bin");

const MIME_TYPE = "application/octet-stream";

// Maximum number of simultaneous uploads
const CONCURRENCY = 5;


// JWT token



// ========================================
// VALIDATION
// ========================================

if (!TOKEN) {

    console.error(
        "UPLOAD_TOKEN is missing from environment variables."
    );

    process.exit(1);
}


if (!fs.existsSync(FILE_PATH)) {

    console.error(
        `File not found: ${FILE_PATH}`
    );

    process.exit(1);
}


// ========================================
// FILE INFORMATION
// ========================================

const fileName =
    path.basename(FILE_PATH);

const fileSize =
    fs.statSync(FILE_PATH).size;


// 5 MB
const CHUNK_SIZE =
    5 * 1024 * 1024;

const totalParts =
    Math.ceil(fileSize / CHUNK_SIZE);


console.log("\n================================");
console.log("SCALABLE FILE UPLOAD");
console.log("================================");

console.log("File:", fileName);

console.log(
    "File size:",
    (fileSize / 1024 / 1024).toFixed(2),
    "MB"
);

console.log(
    "Chunk size:",
    CHUNK_SIZE / 1024 / 1024,
    "MB"
);

console.log(
    "Total parts:",
    totalParts
);

console.log(
    "Concurrency:",
    CONCURRENCY
);

console.log("================================\n");


// ========================================
// STEP 1 — INITIATE
// ========================================

async function initiateUpload() {

    console.log("1. Initiating multipart upload...");

    const response = await axios.post(

        `${API_BASE_URL}/api/files/multipart/initiate`,

        {
            fileName,
            mimeType: MIME_TYPE,
            fileSize
        },

        {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );


    console.log(
        "Upload initiated:",
        response.data.uploadId
    );


    return response.data;
}


// ========================================
// STEP 2 — GENERATE PART URLS
// ========================================

async function generatePartUrls(
    uploadId,
    key
) {

    console.log("\n2. Generating signed URLs...");

    const response = await axios.post(

        `${API_BASE_URL}/api/files/multipart/parts`,

        {
            uploadId,
            key,
            totalParts
        },

        {
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );


    console.log(
        "Generated",
        response.data.partUrls.length,
        "signed URLs"
    );


    return response.data.partUrls;
}


// ========================================
// STEP 3 — READ FILE CHUNK
// ========================================

async function readChunk(partNumber) {

    const start =
        (partNumber - 1) * CHUNK_SIZE;

    const end =
        Math.min(
            start + CHUNK_SIZE,
            fileSize
        );

    const length =
        end - start;


    // Allocate memory only for this chunk
    const buffer =
        Buffer.alloc(length);


    // Open the file
    const file =
        await fsPromises.open(
            FILE_PATH,
            "r"
        );


    try {

        // Read only the required portion
        await file.read(
            buffer,
            0,
            length,
            start
        );

    } finally {

        // Always close the file
        await file.close();

    }


    return buffer;
}
// ========================================
// STEP 4 — UPLOAD ONE PART
// ========================================

async function uploadPart(
    partNumber,
    url,
    uploadId
) {

    const chunk =
        await readChunk(partNumber);


    for (
        let attempt = 1;
        attempt <= MAX_RETRIES + 1;
        attempt++
    ) {

        try {

            console.log(
                `Uploading part ${partNumber}/${totalParts}...`
            );


            // Upload directly to S3
            const response =
                await axios.put(
                    url,
                    chunk,
                    {
                        headers: {
                            "Content-Length": chunk.length
                        },

                        timeout: 120000
                    }
                );


            // Get ETag returned by S3
            const etag =
                response.headers.etag;


            // Record successful part in backend
           await axios.post(
    `${API_BASE_URL}/api/files/multipart/part`,
    {
        uploadId,
        partNumber,
        etag: response.headers.etag
    },
    {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json"
        }
    }
);


            console.log(
                `✓ Part ${partNumber} uploaded and recorded`
            );


            return {
                PartNumber: partNumber,
                ETag: etag
            };


        } catch (error) {

            console.error(
                `✗ Part ${partNumber} failed (attempt ${attempt})`
            );


            if (
                attempt >
                MAX_RETRIES
            ) {

                console.error(
                    `Part ${partNumber} failed after ${MAX_RETRIES} retries`
                );

                throw error;
            }


            console.log(
                `↻ Retrying part ${partNumber} in ${RETRY_DELAY / 1000}s...`
            );


            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        RETRY_DELAY
                    )
            );
        }
    }
}


// ========================================
// STEP 5 — PARALLEL UPLOAD
// ========================================

async function uploadParts(
    partUrls,
    uploadId
) {

    console.log(
        "\n3. Uploading parts in parallel..."
    );


    const results = [];

    let nextIndex = 0;


    async function worker() {

        while (true) {

            const currentIndex =
                nextIndex++;


            if (
                currentIndex >=
                partUrls.length
            ) {
                return;
            }


            const part =
                partUrls[currentIndex];


            const result =
                 await uploadPart(
                 part.partNumber,
                 part.url,
                  uploadId
    );


            results.push(result);
        }
    }


    const workers = [];


    for (
        let i = 0;
        i < Math.min(
            CONCURRENCY,
            partUrls.length
        );
        i++
    ) {

        workers.push(
            worker()
        );
    }


    await Promise.all(workers);


    // S3 expects parts in ascending order
    results.sort(
        (a, b) =>
            a.PartNumber -
            b.PartNumber
    );


    console.log(
        "\nAll parts uploaded successfully."
    );


    return results;
}


// ========================================
// STEP 6 — COMPLETE UPLOAD
// ========================================

async function completeUpload(
    uploadId,
    key,
    parts
) {

    console.log(
        "\n4. Completing multipart upload..."
    );


    const response =
        await axios.post(

            `${API_BASE_URL}/api/files/multipart/complete`,

            {
                uploadId,
                key,
                parts
            },

            {
                headers: {
                    Authorization:
                        `Bearer ${TOKEN}`,

                    "Content-Type":
                        "application/json"
                }
            }
        );


    console.log(
        "\n✓ Multipart upload completed!"
    );


    console.log(
        "S3 Key:",
        response.data.file?.s3Key ||
        response.data.key
    );


    return response.data;
}


// ========================================
// MAIN
// ========================================

async function main() {

    try {

        const startTime =
            Date.now();


        // 1. Initiate

        const upload =
            await initiateUpload();


        // 2. Generate URLs

        const partUrls =
            await generatePartUrls(
                upload.uploadId,
                upload.key
            );


        // 3. Upload chunks

        const parts =
        await uploadParts(
        partUrls,
        upload.uploadId
    );


        // 4. Complete

        await completeUpload(
            upload.uploadId,
            upload.key,
            parts
        );


        const endTime =
            Date.now();


        const seconds =
            (endTime - startTime) /
            1000;


        console.log(
            "\n================================"
        );

        console.log(
            "UPLOAD FINISHED"
        );

        console.log(
            "Time:",
            seconds.toFixed(2),
            "seconds"
        );

        console.log(
            "Parts:",
            parts.length
        );

        console.log(
            "================================\n"
        );


    } catch (error) {

        console.error(
            "\nUPLOAD FAILED"
        );


        if (error.response) {

            console.error(
                "Status:",
                error.response.status
            );

            console.error(
                "Response:",
                error.response.data
            );

        } else {

            console.error(
                error.message
            );

        }

    }
}


main();