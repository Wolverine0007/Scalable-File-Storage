const express = require("express");


const authenticateToken =
    require("../middleware/auth.middleware");

const {
    initiateUpload,
    generatePartUrls,
    completeUpload,
    recordUploadedPart
} = require("../controllers/multipart.controller");


const router = express.Router();


router.post(
    "/initiate",
    authenticateToken,
    initiateUpload
);


router.post(
    "/parts",
    authenticateToken,
    generatePartUrls
);

router.post(
    "/complete",
    authenticateToken,
    completeUpload
);

router.post(
    "/part-completed",
    recordUploadedPart
);

router.post(
    "/multipart/part",
    authenticateToken,
    recordUploadedPart
);

module.exports = router;