const express = require("express");

const authenticateToken =
    require("../middleware/auth.middleware");

const {
    initiateUpload,
    generatePartUrls,
    completeUpload,
    recordUploadedPart,
    getUploadProgress
} = require("../controllers/multipart.controller");

const {
    abortMultipartUploadController
} = require("../controllers/file.controller");

const router = express.Router();


// Initiate multipart upload
router.post(
    "/initiate",
    authenticateToken,
    initiateUpload
);


// Generate signed URLs
router.post(
    "/parts",
    authenticateToken,
    generatePartUrls
);


// Record uploaded part
router.post(
    "/part",
    authenticateToken,
    recordUploadedPart
);


// Get upload progress
router.get(
    "/progress/:uploadId",
    authenticateToken,
    getUploadProgress
);


// Complete multipart upload
router.post(
    "/complete",
    authenticateToken,
    completeUpload
);


// Abort multipart upload
router.post(
    "/abort",
    authenticateToken,
    abortMultipartUploadController
);


module.exports = router;