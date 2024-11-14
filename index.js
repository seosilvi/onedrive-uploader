const { ExifTool } = require("exiftool-vendored");
const exiftool = new ExifTool();
const fs = require("fs");
const path = require("path");

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Hello, OneDrive uploader!');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

async function addGeolocationToImage(filePath, latitude, longitude) {
  try {
    await exiftool.write(filePath, {
      GPSLatitude: latitude,
      GPSLatitudeRef: latitude >= 0 ? "N" : "S",
      GPSLongitude: longitude,
      GPSLongitudeRef: longitude >= 0 ? "E" : "W",
    });
    console.log("Geolocation data added successfully!");
    return filePath; // Return the path of the modified file
  } catch (error) {
    console.error("Error adding geolocation data:", error);
    return null;
  }
}
async function processAndUploadImage(filePath, latitude, longitude, filename) {
  // Add geolocation metadata
  const modifiedFilePath = await addGeolocationToImage(filePath, latitude, longitude);

  if (modifiedFilePath) {
    // If geolocation data was added successfully, upload to OneDrive
    await uploadToOneDrive(modifiedFilePath, filename);
  } else {
    console.error("Failed to add geolocation metadata. Upload aborted.");
  }
}

async function uploadToOneDrive(filePath, filename) {
  const fileContent = fs.createReadStream(filePath);
  const oneDriveUploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/UploadedFiles/${filename}:/content`;

  try {
    const response = await fetch(oneDriveUploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`, // Use your access token
        'Content-Type': 'image/jpeg',
      },
      body: fileContent
    });

    if (response.ok) {
      console.log("Uploaded successfully to OneDrive");
    } else {
      const error = await response.json();
      console.error("Failed to upload:", error);
    }
  } catch (error) {
    console.error("Error during upload:", error);
  }
}
// Example coordinates (latitude and longitude)
const latitude = 51.5074; // Replace with your latitude
const longitude = -0.1278; // Replace with your longitude
const filename = "sample_image.jpg"; // Replace with your desired filename
const filePath = path.join(__dirname, filename); // Local file path to the image

// Process and upload the image
processAndUploadImage(filePath, latitude, longitude, filename);
process.on("exit", () => exiftool.end());

