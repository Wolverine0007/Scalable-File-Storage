const express = require("express");

const upload = require("../middleware/upload.middleware");

const authenticateToken =
    require("../middleware/auth.middleware");

const {
    uploadSingleFile,
    getUserFiles,
    downloadFile,
    deleteUserFile
} = require("../controllers/file.controller");

const router = express.Router();


// Single file upload
router.post(
    "/upload",
    authenticateToken,
    upload.single("file"),
    uploadSingleFile
);


// Get user's files
router.get(
    "/",
    authenticateToken,
    getUserFiles
);


// Download file
router.get(
    "/:id/download",
    authenticateToken,
    downloadFile
);


// Delete file
router.delete(
    "/:id",
    authenticateToken,
    deleteUserFile
);


module.exports = router;