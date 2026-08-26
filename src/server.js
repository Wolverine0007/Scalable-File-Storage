require("dotenv").config();

const app = require("./app");
const db = require("./config/db");
const redisClient = require("./config/redis");

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await db.getConnection();

        console.log("MySQL connected successfully");

        await redisClient.connect();

        console.log("Redis connected successfully");

        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error("Server startup error:", error);
    }
}

startServer();