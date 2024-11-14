const { ExifTool } = require("exiftool-vendored");
const exiftool = new ExifTool();
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch"); // Ensure to install with npm install node-fetch
const express = require('express');
const cors = require('cors');
const multer = require('multer'); // Middleware for handling file uploads

const app = express();
const port = process.env.PORT || 3000;

// Set initial tokens from environment variables
let accessToken = process.env.ACCESS_TOKEN;
let refreshToken = process.env.REFRESH_TOKEN;

// Allow requests from https://sncleaningservices.co.uk
app.use(cors({
  origin: 'https://sncleaningservices.co.uk'
}));

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Basic route to check server status
app.get('/', (req, res) => {
    res.send('Hello, OneDrive uploader!');
});

// Function to refresh the access token
async function refreshAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
  console.log("Attempting to refresh access token...");
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/.default'
    })
  });
  
  const data = await response.json();
  console.log("Token Refresh Response:", data); // Log the full response for debugging
  
  if (data.access_token) {
    accessToken = data.access_token; // Update the access token in memory
    refreshToken = data.refresh_token || refreshToken; // Update refresh token if provided
    console.log("Access token refreshed successfully.");
    return true;
  } else {
    console.error("Failed to refresh access token:", data);
    return false;
  }
}

// Upload route
app.post('/upload', upload.single('file'), async (req, res) => {
    const { latitude, longitude, tag } = req.body;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = path.resolve(file.path);
    const filename = `SN_Cleaning_${tag}_${Date.now()}_${file.originalname}`;

    try {
        console.log(`Adding geolocation to ${filename}`);
        const modifiedFilePath = await addGeolocationToImage(filePath, latitude, longitude);

        if (modifiedFilePath) {
            console.log(`Uploading ${filename} to OneDrive`);
            const uploadResult = await uploadToOneDrive(modifiedFilePath, filename);
            if (uploadResult) {
                res.status(200).json({ message: 'Uploaded successfully', url: uploadResult });
            } else {
                res.status(500).json({ error: 'Failed to upload to OneDrive' });
            }
        } else {
            res.status(500).json({ error: 'Failed to add geolocation metadata' });
        }
    } catch (error) {
        console.error("Error processing upload:", error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        fs.unlinkSync(filePath); // Clean up the temporary file
    }
});

// Add geolocation metadata to image
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

// Upload file to OneDrive
async function uploadToOneDrive(filePath, filename) {
  const fileContent = fs.createReadStream(filePath);
  const oneDriveUploadUrl = `https://graph.microsoft.com/v1.0/drive/root:/UploadedFiles/${filename}:/content`;

  try {
    let response = await fetch(oneDriveUploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'image/jpeg',
      },
      body: fileContent
    });

    // Check if token is expired and refresh if necessary
    if (response.status === 401) {
      console.log("Access token expired. Refreshing token...");
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry the upload with the new access token
        response = await fetch(oneDriveUploadUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'image/jpeg',
          },
          body: fileContent
        });
      } else {
        console.error("Failed to refresh access token.");
        return null;
      }
    }

    if (response.ok) {
      const data = await response.json();
      console.log("Uploaded successfully to OneDrive:", data);
      return data.webUrl; // Return URL of uploaded file
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

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Close the exiftool instance on exit
process.on("exit", () => exiftool.end());
