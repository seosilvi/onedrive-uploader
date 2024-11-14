const { ExifTool } = require("exiftool-vendored");
const exiftool = new ExifTool();
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch"); // Make sure to install this with npm install node-fetch
const express = require('express');
const multer = require('multer'); // Middleware for handling file uploads
const app = express();
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' }); // Temp storage for uploaded files

// Basic route to check server status
app.get('/', (req, res) => {
    res.send('Hello, OneDrive uploader!');
});

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
  const oneDriveUploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/UploadedFiles/${filename}:/content`;

  try {
    const response = await fetch(oneDriveUploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
        'Content-Type': 'image/jpeg',
      },
      body: fileContent
    });

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
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Allow requests from https://sncleaningservices.co.uk
app.use(cors({
  origin: 'https://sncleaningservices.co.uk'
}));

app.get('/', (req, res) => {
    res.send('Hello, OneDrive uploader!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

