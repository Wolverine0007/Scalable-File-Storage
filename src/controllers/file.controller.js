const crypto = require("crypto");
const redisClient = require("../config/redis");

const db = require("../config/db");
const {
    uploadFile,
    generateDownloadUrl,
    deleteFile,
    abortMultipartUpload
} = require("../services/s3.service");

const {
    deleteUserFilesCache
} = require("../services/cache.service");

async function uploadSingleFile(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded"
            });
        }

        // Temporary user ID until authentication is implemented
        const userId = req.user.userId;
         console.log("Authenticated user ID:", userId); // for debugging

        const uniqueName =
            `${crypto.randomUUID()}-${req.file.originalname}`;

        const s3Key = `users/${userId}/${uniqueName}`;

        // Upload file to S3
        await uploadFile(
            req.file.buffer,
            s3Key,
            req.file.mimetype
        );

        // Store metadata in MySQL
        const [result] = await db.execute(
            `INSERT INTO files
            (user_id, file_name, file_size, mime_type, s3_key, status)
            VALUES (?, ?, ?, ?, ?, 'completed')`,
            [
                userId,
                req.file.originalname,
                req.file.size,
                req.file.mimetype,
                s3Key
            ]
        );

        res.status(201).json({
            success: true,
            message: "File uploaded successfully",
            file: {
                id: result.insertId,
                fileName: req.file.originalname,
                size: req.file.size,
                mimeType: req.file.mimetype
            }
        });

        await deleteUserFilesCache(userId);

    } catch (error) {
        console.error("Upload error:", error);

        res.status(500).json({
            success: false,
            message: "File upload failed"
        });
    }
}

 async function getUserFiles(req, res) {
    try {
        const userId = req.user.userId;

        const cacheKey = `files:user:${userId}`;

        // 1. Check Redis
        const cachedFiles = await redisClient.get(cacheKey);

        if (cachedFiles) {
            console.log("Redis cache HIT");

            return res.json({
                success: true,
                source: "redis",
                files: JSON.parse(cachedFiles)
            });
        }

        console.log("Redis cache MISS");

        // 2. Get data from MySQL
        const [files] = await db.execute(
            `SELECT
                id,
                file_name,
                file_size,
                mime_type,
                status,
                created_at
             FROM files
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [userId]
        );

        // 3. Store result in Redis
        await redisClient.set(
            cacheKey,
            JSON.stringify(files),
            {
                EX: 60
            }
        );

        res.json({
            success: true,
            source: "mysql",
            files
        });

    } catch (error) {
        console.error("Get files error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to retrieve files"
        });
    }
}

async function downloadFile(req, res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const [files] = await db.execute(
            `SELECT
                id,
                user_id,
                file_name,
                mime_type,
                s3_key
             FROM files
             WHERE id = ?
             AND user_id = ?`,
            [fileId, userId]
        );

        if (files.length === 0) {
            return res.status(404).json({
                success: false,
                message: "File not found"
            });
        }

        const file = files[0];

        const downloadUrl = await generateDownloadUrl(
            file.s3_key,
            file.file_name
        );

        res.json({
            success: true,
            file: {
                id: file.id,
                fileName: file.file_name,
                mimeType: file.mime_type
            },
            downloadUrl
        });

    } catch (error) {
        console.error("Download error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to generate download URL"
        });
    }
}

async function deleteUserFile(req, res) {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        // 1. Find the file and verify ownership
        const [files] = await db.execute(
            `SELECT
                id,
                user_id,
                file_name,
                s3_key
             FROM files
             WHERE id = ?
             AND user_id = ?`,
            [fileId, userId]
        );

        // File doesn't exist OR belongs to another user
        if (files.length === 0) {
            return res.status(404).json({
                success: false,
                message: "File not found"
            });
        }

        const file = files[0];

        // 2. Delete the actual object from S3
        await deleteFile(file.s3_key);

        // 3. Delete metadata from MySQL
        await db.execute(
            `DELETE FROM files
             WHERE id = ?
             AND user_id = ?`,
            [fileId, userId]
        );

        res.json({
            success: true,
            message: "File deleted successfully",
            fileId: file.id
        });

        await deleteUserFilesCache(userId);

    } catch (error) {
        console.error("Delete error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to delete file"
        });
    }
}

async function abortMultipartUploadController(req, res) {
    try {
        const userId = req.user.userId;
        const { uploadId } = req.body;

        // 1. Validate uploadId
        if (!uploadId) {
            return res.status(400).json({
                success: false,
                message: "uploadId is required"
            });
        }

        // 2. Find upload session belonging to this user
        const [sessions] = await db.execute(
            `
            SELECT
                id,
                upload_id,
                s3_key,
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

        // 3. Don't abort completed upload
        if (session.status === "completed") {
            return res.status(400).json({
                success: false,
                message: "Upload is already completed"
            });
        }

        // 4. Don't abort an already aborted upload
        if (session.status === "aborted") {
            return res.status(400).json({
                success: false,
                message: "Upload is already aborted"
            });
        }

        // 5. Abort multipart upload in S3
        await abortMultipartUpload(
            session.s3_key,
            uploadId
        );

        // 6. Mark upload session as aborted
        await db.execute(
            `
            UPDATE upload_sessions
            SET status = 'aborted'
            WHERE id = ?
            `,
            [session.id]
        );

        // 7. Delete temporary uploaded-part records
        await db.execute(
            `
            DELETE FROM upload_parts
            WHERE upload_session_id = ?
            `,
            [session.id]
        );

        // 8. Send response
        return res.status(200).json({
            success: true,
            message: "Multipart upload aborted and cleaned up successfully",
            uploadId,
            status: "aborted"
        });

    } catch (error) {
        console.error(
            "Abort multipart upload error:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to abort multipart upload"
        });
    }
}



module.exports = {
    uploadSingleFile,
    getUserFiles,
    downloadFile,
    deleteUserFile,
    abortMultipartUploadController
};