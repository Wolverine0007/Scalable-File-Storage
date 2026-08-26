const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const fileRoutes = require("./routes/file.routes");
const multipartRoutes = require("./routes/multipart.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
    res.json({
        success: true,
        message: "Scalable File Storage API is running"
    });
});

app.use(
    "/api/auth",
    authRoutes
);

app.use(
    "/api/files",
    fileRoutes
);

app.use(
    "/api/files/multipart",
    multipartRoutes
);

module.exports = app;