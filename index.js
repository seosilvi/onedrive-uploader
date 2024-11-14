const { ExifTool } = require("exiftool-vendored");
const exiftool = new ExifTool();
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const app = express();
const port = process.env.PORT || 3000;

let accessToken = process.env.ACCESS_TOKEN;
let refreshToken = process.env.REFRESH_TOKEN;

// Allow CORS requests from your domain
app.use(cors({
  origin: 'https://sncleaningservices.co.uk'
}));

// Set up multer to handle file uploads
const upload = multer({ dest: 'uploads/' });

// Route to check server status
app.get('/', (req, res) => {
    res.send('Hello, OneDrive uploader!');
});

// Helper function to refresh the access token
async function refreshAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
  
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
  
  if (data.access_token) {
    accessToken = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    return true;
  } else {
    console.error("Failed to refresh access token:", data);
    return false;
  }
}

// Upload endpoint to receive the data
app.post('/upload', upload.single('file'), async (req, res) => {
    const { latitude, longitude, tag, postcode, frontly_id, form_name } = req.body;
    const file = req.file;

    // Log each received value to ensure they’re present
    console.log("Received data on the server:");
    console.log("File:", file ? file.originalname : 'No file received');
    console.log("Tag:", tag);
    console.log("Latitude:", latitude);
    console.log("Longitude:", longitude);
    console.log("Postcode:", postcode);
    console.log("Frontly ID:", frontly_id);
    console.log("Form Name:", form_name);

    // Return an error if file or postcode is missing
    if (!file || !postcode) {
        return res.status(400).json({ error: 'File and postcode are required' });
    }

    const date = new Date().toISOString().split('T')[0];
    const folderName = `${postcode}_${date}`;
    const filePath = path.resolve(file.path);
    const filename = `SN_Cleaning_${tag}_${Date.now()}_${file.originalname}`;

    try {
        const folderId = await createOneDriveFolder(folderName);
        if (!folderId) {
            return res.status(500).json({ error: 'Failed to create folder in OneDrive' });
        }

        console.log(`Adding geolocation to ${filename}`);
        const modifiedFilePath = await addGeolocationToImage(filePath, latitude, longitude);

        if (modifiedFilePath) {
            console.log(`Uploading ${filename} to folder ${folderName} in OneDrive`);
            const uploadResult = await uploadToOneDrive(modifiedFilePath, folderId, filename);
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

// Function to add geolocation metadata to the image
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

// Helper function to create a folder in OneDrive
async function createOneDriveFolder(folderName) {
  const createFolderUrl = `https://graph.microsoft.com/v1.0/drive/root:/UploadedFiles/${folderName}:/children`;

  try {
    const response = await fetch(createFolderUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename'
      })
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

// Helper function to upload file to OneDrive
async function uploadToOneDrive(filePath, folderId, filename) {
  const fileContent = fs.createReadStream(filePath);
  const oneDriveUploadUrl = `https://graph.microsoft.com/v1.0/drive/items/${folderId}:/${filename}:/content`;

  try {
    let response = await fetch(oneDriveUploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'image/jpeg',
      },
      body: fileContent
    });

    if (response.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        response = await fetch(oneDriveUploadUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'image/jpeg',
          },
          body: fileContent
        });
      } else {
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

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

process.on("exit", () => exiftool.end());
