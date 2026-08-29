const cron = require("node-cron");

const {
    cleanupMultipartUploads
} = require("../../scripts/cleanup-multipart");

function startMultipartCleanupJob() {

    cron.schedule("0 * * * *", async () => {

        console.log("");
        console.log("Running scheduled multipart cleanup...");

        try {

            await cleanupMultipartUploads();

            console.log(
                "Scheduled multipart cleanup completed."
            );

        } catch (error) {

            console.error(
                "Scheduled multipart cleanup failed:",
                error
            );

        }

    });

    console.log(
        "Multipart cleanup job scheduled: every hour"
    );
}

module.exports = {
    startMultipartCleanupJob
};