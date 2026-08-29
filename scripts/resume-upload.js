require("dotenv").config();

const fs = require("fs");
const path = require("path");
const axios = require("axios");


// ========================================
// CONFIGURATION
// ========================================

const API_BASE_URL =
    process.env.API_BASE_URL || "http://localhost:3000";

const TOKEN =
    process.env.UPLOAD_TOKEN;

const FILE_PATH =
    path.join(__dirname, "../test-files/large-test.bin");

const CHUNK_SIZE =
    5 * 1024 * 1024; // 5 MB

const CONCURRENCY = 5;

const MAX_RETRIES = 3;

const RETRY_DELAY = 1000;


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
// GET UPLOAD ID
// ========================================

const uploadId =
    process.argv[2];

if (!uploadId) {

    console.error(
        "\nUsage:"
    );

    console.error(
        "node scripts/resume-upload.js <uploadId>\n"
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

const totalParts =
    Math.ceil(
        fileSize / CHUNK_SIZE
    );


console.log("\n================================");
console.log("RESUMABLE FILE UPLOAD");
console.log("================================");

console.log(
    "File:",
    fileName
);

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

console.log(
    "Upload ID:",
    uploadId
);

console.log("================================\n");


// ========================================
// STEP 1 — GET PROGRESS
// ========================================

async function getProgress() {

    console.log(
        "1. Checking upload progress..."
    );


    const response =
        await axios.get(

            `${API_BASE_URL}/api/files/multipart/progress/${encodeURIComponent(uploadId)}`,

            {
                headers: {
                    Authorization:
                        `Bearer ${TOKEN}`
                }
            }
        );


    const data =
        response.data;


    console.log(
        "Upload status:",
        data.status
    );

    console.log(
        "Uploaded parts:",
        data.uploadedParts.length,
        "/",
        data.totalParts
    );


    if (data.status === "completed") {

        console.log(
            "\nThis upload is already completed."
        );

        process.exit(0);
    }


    return data;
}


// ========================================
// STEP 2 — GENERATE SIGNED URLs
// ========================================

async function generatePartUrls(
    key
) {

    console.log(
        "\n2. Generating signed URLs..."
    );


    const response =
        await axios.post(

            `${API_BASE_URL}/api/files/multipart/parts`,

            {
                uploadId,
                key,
                totalParts
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
        "Generated",
        response.data.partUrls.length,
        "signed URLs"
    );


    return response.data.partUrls;
}


// ========================================
// STEP 3 — READ FILE CHUNK
// ========================================

function readChunk(partNumber) {

    const start =
        (partNumber - 1) * CHUNK_SIZE;


    const end =
        Math.min(
            start + CHUNK_SIZE,
            fileSize
        );


    const length =
        end - start;


    const buffer =
        Buffer.alloc(length);


    const fd =
        fs.openSync(
            FILE_PATH,
            "r"
        );


    try {

        fs.readSync(
            fd,
            buffer,
            0,
            length,
            start
        );

    } finally {

        fs.closeSync(fd);

    }


    return buffer;
}


// ========================================
// STEP 4 — RECORD UPLOADED PART
// ========================================

async function recordUploadedPart(
    partNumber,
    etag
) {

    const response =
        await axios.post(

            `${API_BASE_URL}/api/files/multipart/part`,

            {
                uploadId,
                partNumber,
                etag
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


    return response.data;
}


// ========================================
// STEP 5 — UPLOAD ONE MISSING PART
// ========================================

async function uploadPart(
    partNumber,
    url
) {

    const chunk =
        readChunk(partNumber);


    for (
        let attempt = 1;
        attempt <= MAX_RETRIES + 1;
        attempt++
    ) {

        try {

            console.log(
                `Uploading missing part ${partNumber}/${totalParts}...`
            );


            const response =
                await axios.put(
                    url,
                    chunk,
                    {
                        headers: {
                            "Content-Length":
                                chunk.length
                        },

                        timeout: 120000
                    }
                );


            const etag =
                response.headers.etag;


            await recordUploadedPart(
                partNumber,
                etag
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
// STEP 6 — UPLOAD MISSING PARTS
// ========================================

async function uploadMissingParts(
    missingParts
) {

    console.log(
        "\n3. Uploading missing parts..."
    );


    if (missingParts.length === 0) {

        console.log(
            "No missing parts."
        );

        return [];
    }


    const results = [];

    let nextIndex = 0;


    async function worker() {

        while (true) {

            const currentIndex =
                nextIndex++;


            if (
                currentIndex >=
                missingParts.length
            ) {

                return;
            }


            const part =
                missingParts[currentIndex];


            const result =
                await uploadPart(
                    part.partNumber,
                    part.url
                );


            results.push(result);
        }
    }


    const workers = [];


    for (
        let i = 0;
        i < Math.min(
            CONCURRENCY,
            missingParts.length
        );
        i++
    ) {

        workers.push(
            worker()
        );
    }


    await Promise.all(
        workers
    );


    results.sort(
        (a, b) =>
            a.PartNumber -
            b.PartNumber
    );


    console.log(
        "\nAll missing parts uploaded successfully."
    );


    return results;
}


// ========================================
// STEP 7 — COMPLETE UPLOAD
// ========================================

async function completeUpload(
    key,
    allParts
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
                parts: allParts
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


        // 1. Check current progress

        const progress =
            await getProgress();


        const key =
            progress.key;


        // ====================================
        // Find already uploaded parts
        // ====================================

        const uploadedPartNumbers =
            new Set(
                progress.uploadedParts.map(
                    part =>
                        Number(
                            part.part_number
                        )
                )
            );


        console.log(
            "\nAlready uploaded:"
        );

        if (
            uploadedPartNumbers.size === 0
        ) {

            console.log(
                "None"
            );

        } else {

            console.log(
                [...uploadedPartNumbers]
                    .sort(
                        (a, b) => a - b
                    )
                    .join(", ")
            );
        }


        // ====================================
        // Generate URLs
        // ====================================

        const partUrls =
            await generatePartUrls(
                key
            );


        // ====================================
        // Find missing parts
        // ====================================

        const missingParts =
            partUrls.filter(
                part =>
                    !uploadedPartNumbers.has(
                        Number(
                            part.partNumber
                        )
                    )
            );


        console.log(
            "\nMissing parts:"
        );


        if (
            missingParts.length === 0
        ) {

            console.log(
                "None"
            );

        } else {

            console.log(
                missingParts
                    .map(
                        part =>
                            part.partNumber
                    )
                    .join(", ")
            );
        }


        // ====================================
        // Upload missing parts
        // ====================================

        await uploadMissingParts(
            missingParts
        );


        // ====================================
        // Get latest progress
        // ====================================

        console.log(
            "\n5. Getting final part list..."
        );


        const finalProgress =
            await getProgress();


        const allParts =
            finalProgress.uploadedParts
                .map(
                    part => ({
                        PartNumber:
                            Number(
                                part.part_number
                            ),

                        ETag:
                            part.etag
                    })
                )
                .sort(
                    (a, b) =>
                        a.PartNumber -
                        b.PartNumber
                );


        // ====================================
        // Make sure all parts exist
        // ====================================

        if (
            allParts.length !==
            totalParts
        ) {

            throw new Error(
                `Cannot complete upload. ` +
                `Only ${allParts.length}/${totalParts} parts are recorded.`
            );
        }


        // ====================================
        // Complete
        // ====================================

        await completeUpload(
            key,
            allParts
        );


        const endTime =
            Date.now();


        const seconds =
            (
                endTime -
                startTime
            ) / 1000;


        console.log(
            "\n================================"
        );

        console.log(
            "RESUME UPLOAD FINISHED"
        );

        console.log(
            "Time:",
            seconds.toFixed(2),
            "seconds"
        );

        console.log(
            "Parts:",
            allParts.length
        );

        console.log(
            "================================\n"
        );


    } catch (error) {

        console.error(
            "\nRESUME UPLOAD FAILED"
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







