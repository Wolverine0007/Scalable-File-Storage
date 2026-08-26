
const redisClient = require("../config/redis");

async function deleteUserFilesCache(userId) {
    const cacheKey = `files:user:${userId}`;

    await redisClient.del(cacheKey);

    console.log(`Redis cache invalidated: ${cacheKey}`);
}

module.exports = {
    deleteUserFilesCache
};