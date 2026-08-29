require("dotenv").config();

const db = require("../src/config/db");

const {
    abortMultipartUpload
} = require("../src/services/s3.service");

const CLEANUP_AFTER_HOURS =
    Number(process.env.MULTIPART_CLEANUP_HOURS || 1);


async function cleanupMultipartUploads() {

    console.log("=================================");
    console.log("MULTIPART UPLOAD CLEANUP");
    console.log("=================================");

    try {

        // Find abandoned multipart uploads
        const [sessions] = await db.execute(
            `
            SELECT
                id,
                upload_id,
                s3_key,
                file_name,
                status,
                created_at
            FROM upload_sessions
            WHERE status IN ('initiated', 'uploading')
              AND created_at < DATE_SUB(
                  NOW(),
                  INTERVAL ? HOUR
              )
            `,
            [CLEANUP_AFTER_HOURS]
        );

        console.log(
            `Found ${sessions.length} abandoned upload(s).`
        );

        if (sessions.length === 0) {
            console.log("Nothing to clean.");
            return;
        }


        for (const session of sessions) {

            console.log("");
            console.log(`Cleaning upload: ${session.upload_id}`);
            console.log(`File: ${session.file_name}`);
            console.log(`Status: ${session.status}`);

            try {

                // 1. Abort multipart upload in S3
                await abortMultipartUpload(
                    session.s3_key,
                    session.upload_id
                );

                console.log("✓ S3 multipart upload aborted");


                // 2. Mark session as aborted
                await db.execute(
                    `
                    UPDATE upload_sessions
                    SET status = 'aborted'
                    WHERE id = ?
                    `,
                    [session.id]
                );


                // 3. Delete temporary part records
                await db.execute(
                    `
                    DELETE FROM upload_parts
                    WHERE upload_session_id = ?
                    `,
                    [session.id]
                );

                console.log("✓ Database cleanup completed");

            } catch (error) {

                console.error(
                    `✗ Failed to clean upload ${session.upload_id}`
                );

                console.error(error.message);
            }
        }


        console.log("");
        console.log("=================================");
        console.log("CLEANUP FINISHED");
        console.log("=================================");

    } catch (error) {

        console.error(
            "Multipart cleanup failed:",
            error
        );
    }
}


// Export function for scheduled cleanup job
module.exports = {
    cleanupMultipartUploads
};


// Allow this file to also be executed directly
if (require.main === module) {

    cleanupMultipartUploads()
        .then(() => db.end())
        .catch(() => db.end());

}