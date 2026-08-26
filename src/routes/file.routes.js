const express = require("express");

const upload = require("../middleware/upload.middleware");
const authenticateToken = require("../middleware/auth.middleware");

const {
    uploadSingleFile,
    getUserFiles,
    downloadFile,
    deleteUserFile
} = require("../controllers/file.controller");

const {
    recordUploadedPart,
    getUploadProgress
} = require("../controllers/multipart.controller");

const router = express.Router();

router.post(
    "/upload",
    authenticateToken,
    upload.single("file"),
    uploadSingleFile
);

router.get(
    "/",
    authenticateToken,
    getUserFiles
);

router.get(
    "/:id/download",
    authenticateToken,
    downloadFile
);

router.delete(
    "/:id",
    authenticateToken,
    deleteUserFile
);
router.post(
    "/multipart/part",
    authenticateToken,
    recordUploadedPart
);

router.get(
    "/multipart/progress/:uploadId",
    authenticateToken,
    getUploadProgress
);



module.exports = router;