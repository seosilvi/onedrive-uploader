const { ExifTool } = require("exiftool-vendored");
const exiftool = new ExifTool();
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const app = express();
const port = process.env.PORT || 3000;

let accessToken = process.env.ACCESS_TOKEN;
let refreshToken = process.env.REFRESH_TOKEN;

app.use(
  cors({
    origin: "https://sncleaningservices.co.uk",
  })
);

const upload = multer({ dest: "uploads/" });

app.get("/", (req, res) => {
  res.send("Hello, OneDrive uploader!");
});

async function refreshAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;

  console.log("Attempting to refresh access token...");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "https://graph.microsoft.com/.default",
    }),
  });

  const data = await response.json();
  console.log("Token Refresh Response:", data);

  if (data.access_token) {
    accessToken = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    console.log("Access token refreshed successfully.");
    return true;
  } else {
    console.error("Failed to refresh access token:", data);
    return false;
  }
}

app.post("/upload", upload.single("file"), async (req, res) => {
  console.log("Received upload request");

  const { latitude, longitude, tag } = req.body;
  const { postcode, frontly_id, form_name } = req.query;
  const file = req.file;

  // Detailed log of received data
  console.log("Request data:", {
    latitude,
    longitude,
    tag,
    postcode,
    frontly_id,
    form_name,
    file: file ? file.originalname : null,
  });

  if (!file || !postcode) {
    console.error("File or postcode is missing");
    return res.status(400).json({ error: "File and postcode are required" });
  }

  const date = new Date().toISOString().split("T")[0];
  const folderName = `${postcode}_${date}`;
  const filePath = path.resolve(file.path);
  const filename = `SN_Cleaning_${tag}_${Date.now()}_${file.originalname}`;

  try {
    // Create folder in OneDrive
    console.log(`Creating OneDrive folder: ${folderName}`);
    const folderId = await createOneDriveFolder(folderName);
    if (!folderId) {
      console.error("Failed to create folder in OneDrive");
      return res.status(500).json({ error: "Failed to create folder in OneDrive" });
    }

    // Add geolocation data to image
    console.log(`Adding geolocation to ${filename}`);
    const modifiedFilePath = await addGeolocationToImage(filePath, latitude, longitude);

    if (modifiedFilePath) {
      // Upload file to OneDrive
      console.log(`Uploading ${filename} to folder ${folderName} in OneDrive`);
      const uploadResult = await uploadToOneDrive(modifiedFilePath, folderId, filename);
      if (uploadResult) {
        console.log("Upload successful");
        res.status(200).json({ message: "Uploaded successfully", url: uploadResult });
      } else {
        console.error("Upload to OneDrive failed");
        res.status(500).json({ error: "Failed to upload to OneDrive" });
      }
    } else {
      console.error("Failed to add geolocation metadata");
      res.status(500).json({ error: "Failed to add geolocation metadata" });
    }
  } catch (error) {
    console.error("Error processing upload:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    fs.unlinkSync(filePath);
  }
});

async function createOneDriveFolder(folderName) {
  const createFolderUrl = `https://graph.microsoft.com/v1.0/drive/root:/UploadedFiles/${folderName}:/children`;

  try {
    const response = await fetch(createFolderUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        "@microsoft.graph.conflictBehavior": "rename",
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("Folder created successfully in OneDrive:", data);
      return data.id;
    } else {
      const error = await response.json();
      console.error("Failed to create folder:", error);
      return null;
    }
  } catch (error) {
    console.error("Error during folder creation:", error);
    return null;
  }
}

async function uploadToOneDrive(filePath, folderId, filename) {
  const fileContent = fs.createReadStream(filePath);
  const oneDriveUploadUrl = `https://graph.microsoft.com/v1.0/drive/items/${folderId}:/${filename}:/content`;

  try {
    let response = await fetch(oneDriveUploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "image/jpeg",
      },
      body: fileContent,
    });

    if (response.status === 401) {
      console.log("Access token expired. Refreshing token...");
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        response = await fetch(oneDriveUploadUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "image/jpeg",
          },
          body: fileContent,
        });
      } else {
        console.error("Failed to refresh access token.");
        return null;
      }
    }

    if (response.ok) {
      const data = await response.json();
      console.log("Uploaded successfully to OneDrive:", data);
      return data.webUrl;
    } else {
      const error = await response.json();
      console.error("Failed to upload:", error);
      return null;
    }
  } catch (error) {
    console.error("Error during upload:", error);
    return null;
  }
}

async function addGeolocationToImage(filePath, latitude, longitude) {
  try {
    await exiftool.write(filePath, {
      GPSLatitude: latitude,
      GPSLatitudeRef: latitude >= 0 ? "N" : "S",
      GPSLongitude: longitude,
      GPSLongitudeRef: longitude >= 0 ? "E" : "W",
    });
    console.log("Geolocation data added successfully!");
    return filePath;
  } catch (error) {
    console.error("Error adding geolocation data:", error);
    return null;
  }
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

process.on("exit", () => exiftool.end());
