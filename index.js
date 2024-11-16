const { ExifTool } = require("exiftool-vendored");
const exiftool = new ExifTool();
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");
const multer = require("multer");

// Initialize express app
const app = express();

// Set the port for the server
const port = process.env.PORT || 3000;

// Middleware to allow CORS requests from your domain
app.use(cors({ origin: "https://sncleaningservices.co.uk" }));

// Set up multer to handle file uploads
const upload = multer({ dest: "uploads/" });

// Predefined folder mappings
const serviceFolderMapping = {
  "Airbnb Cleaning": "01HRAU3CKVL2NOUI3KNZFIMQGWF2W6I6KE",
  "Domestic Cleaning": "01HRAU3CJNFG44TQSQ5RBJOKXJNO7MGHHQ",
  "End Of Tenancy Cleaning": "01HRAU3CMT64WNWGRAENAJ4KECYBFO4Y6C",
  "After Builders Cleaning": "01HRAU3CIERAXDQ73IJFDLT73OV7WR2HIM",
  "Commercial Cleaning": "01HRAU3CMUE53HAO7J6BGJFN64XZMQQEUB",
  "Deep House Cleaning": "01HRAU3CMX5K7X6VAC2NHK2DK3H6R5IGF7",
  "Carpet Cleaning": "01HRAU3CJJ7PDR5EP5GRHKHVAC7RQRA3NG",
};

// Helper function to refresh the access token
async function refreshAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: process.env.REFRESH_TOKEN,
      grant_type: "refresh_token",
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  const data = await response.json();

  if (data.access_token) {
    process.env.ACCESS_TOKEN = data.access_token;
    process.env.REFRESH_TOKEN = data.refresh_token || process.env.REFRESH_TOKEN;
    return true;
  } else {
    console.error("Failed to refresh access token:", data);
    return false;
  }
}

// Upload endpoint to receive the data
app.post("/upload", upload.single("file"), async (req, res) => {
  const { latitude, longitude, tag, postcode, form_name } = req.body;
  const file = req.file;

  console.log("Received data on the server:");
  console.log("File:", file ? file.originalname : "No file received");
  console.log("Tag:", tag);
  console.log("Latitude:", latitude);
  console.log("Longitude:", longitude);
  console.log("Postcode:", postcode);
  console.log("Form Name:", form_name);

  // Validate inputs
  if (!file || !postcode || !form_name) {
    return res.status(400).json({ error: "File, postcode, and form_name are required." });
  }

  const date = new Date().toISOString().split("T")[0];
  const folderName = `${postcode}_${date}`;
  const filePath = path.resolve(file.path);
  const filename = `SN_Cleaning_${tag}_${Date.now()}_${file.originalname}`;

  try {
    // Directly get the folder ID from the mapping
    const parentFolderId = serviceFolderMapping[form_name.trim()];
    if (!parentFolderId) {
      return res.status(400).json({ error: `No mapped folder ID found for form_name: "${form_name}"` });
    }
    console.log(`Mapped parent folder ID for form_name "${form_name}": ${parentFolderId}`);

    const targetFolderId = await createOrGetFolder(parentFolderId, folderName);
    if (!targetFolderId) {
      return res.status(500).json({ error: "Failed to create or get target folder in OneDrive." });
    }

    console.log(`Adding geolocation to ${filename}`);
    const modifiedFilePath = await addGeolocationToImage(filePath, latitude, longitude);

    if (modifiedFilePath) {
      console.log(`Uploading ${filename} to folder ${folderName} in OneDrive`);
      const uploadResult = await uploadToOneDrive(modifiedFilePath, targetFolderId, filename);
      if (uploadResult) {
        res.status(200).json({ message: "Uploaded successfully", url: uploadResult });
      } else {
        res.status(500).json({ error: "Failed to upload to OneDrive" });
      }
    } else {
      res.status(500).json({ error: "Failed to add geolocation metadata" });
    }
  } catch (error) {
    console.error("Error processing upload:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    fs.unlinkSync(filePath); // Clean up the temporary file
  }
});

// Helper function to create or get a folder
async function createOrGetFolder(parentId, folderName) {
  const url = `https://graph.microsoft.com/v1.0/drive/items/${parentId}/children`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` },
    });

    const data = await response.json();

    console.log("Folder search response:", data);

    if (Array.isArray(data.value)) {
      const folder = data.value.find((item) => item.name === folderName && item.folder);
      if (folder) {
        console.log(`Found existing folder: ${folderName}`);
        return folder.id;
      }
    }

    // Folder not found, create it
    return await createFolder(parentId, folderName);
  } catch (error) {
    console.error("Error in createOrGetFolder:", error);
    throw error;
  }
}

// Helper function to create a folder in OneDrive
async function createFolder(parentId, folderName) {
  const url = `https://graph.microsoft.com/v1.0/drive/items/${parentId}/children`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    });

    const data = await response.json();

    if (data.id) {
      console.log(`Folder created: ${folderName}`);
      return data.id;
    } else {
      throw new Error(`Failed to create folder: ${folderName}`);
    }
  } catch (error) {
    console.error("Error creating folder:", error);
    throw error;
  }
}

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Ensure ExifTool exits cleanly
process.on("exit", () => exiftool.end());
