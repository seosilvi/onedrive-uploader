const { ExifTool } = require("exiftool-vendored");
const sharp = require("sharp");
const exiftool = new ExifTool();
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();
const port = process.env.PORT || 3000;

app.use(
  cors({
    origin: "https://sncleaningservices.co.uk",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: "uploads/" });

const serviceFolderMapping = {
  "Airbnb Cleaning": "01HRAU3CKVL2NOUI3KNZFIMQGWF2W6I6KE",
  "Domestic Cleaning": "01HRAU3CJNFG44TQSQ5RBJOKXJNO7MGHHQ",
  "End Of Tenancy Cleaning": "01HRAU3CMT64WNWGRAENAJ4KECYBFO4Y6C",
  "After Builders Cleaning": "01HRAU3CIERAXDQ73IJFDLT73OV7WR2HIM",
  "Commercial Cleaning": "01HRAU3CMUE53HAO7J6BGJFN64XZMQQEUB",
  "Deep House Cleaning": "01HRAU3CMX5K7X6VAC2NHK2DK3H6R5IGF7",
  "Carpet Cleaning": "01HRAU3CJJ7PDR5EP5GRHKHVAC7RQRA3NG",
};

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

async function addStampToImage(filePath, tag) {
  try {
    const stampedFilePath = filePath.replace(/(\.\w+)$/, `_stamped$1`);
    const textOverlay = tag.toLowerCase() === "before" ? "BEFORE" : "AFTER";

    await sharp(filePath)
      .composite([
        {
          input: Buffer.from(
            `<svg>
              <text x="10" y="50" font-size="40" fill="white" stroke="black" stroke-width="1" font-family="Arial">${textOverlay}</text>
            </svg>`
          ),
          gravity: "southeast",
        },
      ])
      .toFile(stampedFilePath);

    console.log(`Stamp added to image: ${stampedFilePath}`);
    return stampedFilePath;
  } catch (error) {
    console.error("Error adding stamp to image:", error.message);
    return null;
  }
}

app.post("/upload", upload.single("file"), async (req, res) => {
  let renamedFilePath, stampedFilePath;
  try {
    const { tag, postcode, form_name, frontly_id } = req.body;
    const file = req.file;

    if (!file || !postcode || !form_name || !frontly_id) {
      return res.status(400).json({ error: "File, postcode, form_name, and frontly_id are required." });
    }

    const filePath = path.resolve(file.path);

    // Rename file
    renamedFilePath = path.join(path.dirname(filePath), `renamed_${file.originalname}`);
    fs.renameSync(filePath, renamedFilePath);

    // Add stamp to image
    stampedFilePath = await addStampToImage(renamedFilePath, tag);
    if (!stampedFilePath) throw new Error("Failed to add stamp to the image.");

    // Simulate successful upload for this example
    console.log("Simulated successful upload.");
    res.status(200).json({ message: "File processed successfully." });
  } catch (error) {
    console.error("Error in /upload endpoint:", error.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    [req.file?.path, renamedFilePath, stampedFilePath].forEach((filePath) => {
      if (filePath) {
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          console.warn(`Temporary file not found for cleanup: ${filePath}`, cleanupError.message);
        }
      }
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
