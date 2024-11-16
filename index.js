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

// Allow CORS requests from your domain
app.use(
  cors({
    origin: "https://sncleaningservices.co.uk",
  })
);

// Set up multer to handle file uploads
const upload = multer({ dest: "uploads/" });

// Route to check server status
app.get("/", (req, res) => {
  res.send("Hello, OneDrive uploader!");
});

// Helper function to refresh the access token
async function refreshAccessToken() {
  const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;

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
app.post("/upload", upload.single("file"), async (req, res) => {
  const { tag, postcode, form_name } = req.body; // Extracted parameters
  const file = req.file;

  console.log("Received data on the server:");
  console.log("File:", file ? file.originalname : "No file received");
  console.log("Tag:", tag);
  console.log("Postcode:", postcode);
  console.log("Form Name:", form_name);

  if (!file || !postcode || !form_name || !tag) {
    return res
      .status(400)
      .json({ error: "File, postcode, form_name, and tag are required" });
  }

  const filePath = path.resolve(file.path);

  try {
    // Step 1: Get Latitude and Longitude from Postcode
    console.log("Fetching geolocation for postcode:", postcode);
    const { latitude, longitude } = await getCoordinatesFromPostcode(postcode);

    // Step 2: Create/Check Service Folder and Postcode Folder
    const serviceFolderId = await getServiceFolderId(form_name);
    const date = new Date().toISOString().split("T")[0].replace(/-/g, "-"); // Format as DD-MM-YYYY
    const postcodeFolderName = `${postcode}_${date}`;
    const postcodeFolderId = await createOrGetFolder(serviceFolderId, postcodeFolderName);

    // Step 3: Create/Check Subfolders (before and after)
    const beforeFolderId = await createOrGetFolder(postcodeFolderId, "before");
    const afterFolderId = await createOrGetFolder(postcodeFolderId, "after");

    // Step 4: Name the File
    const timestamp = new Date().toISOString().replace(/[:.-]/g, "");
    const fileExtension = path.extname(file.originalname);
    const filename = `${postcode}_${form_name.replace(/ /g, "_")}_${tag}_${timestamp}${fileExtension}`;

    // Step 5: Add Geolocation to the Image
    console.log(`Adding geolocation metadata to ${filename}`);
    const modifiedFilePath = await addGeolocationToImage(filePath, latitude, longitude);

    // Step 6: Upload the File to the Correct Subfolder
    const targetFolderId = tag === "before" ? beforeFolderId : afterFolderId;
    console.log(`Uploading ${filename} to ${tag} folder (${targetFolderId}) in OneDrive`);
    const uploadResult = await uploadToOneDrive(modifiedFilePath, targetFolderId, filename);

    if (uploadResult) {
      res.status(200).json({ message: "Uploaded successfully", url: uploadResult });
    } else {
      res.status(500).json({ error: "Failed to upload to OneDrive" });
    }
  } catch (error) {
    console.error("Error processing upload:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    fs.unlinkSync(filePath); // Clean up temporary file
  }
});

// Helper Function: Call Google Geocoding API
async function getCoordinatesFromPostcode(postcode) {
  const apiKey = process.env.GOOGLE_API_KEY; // Make sure this is in your .env file!
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${postcode}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "OK") {
      const location = data.results[0].geometry.location;
      return { latitude: location.lat, longitude: location.lng };
    } else {
      throw new Error(`Failed to get coordinates for postcode: ${postcode}`);
    }
  } catch (error) {
    console.error("Error fetching coordinates:", error);
    throw error;
  }
}

// Helper Function: Get Service Folder ID
async function getServiceFolderId(serviceName) {
  const serviceFolders = {
    "After Builders Cleaning": "01HRAU3CIERAXDQ73IJFDLT73OV7WR2HIM",
    "Airbnb Cleaning": "01HRAU3CKVL2NOUI3KNZFIMQGWF2W6I6KE",
    "Carpet Cleaning": "01HRAU3CJJ7PDR5EP5GRHKHVAC7RQRA3NG",
    "Commercial Cleaning": "01HRAU3CMUE53HAO7J6BGJFN64XZMQQEUB",
    "Deep House Cleaning": "01HRAU3CMX5K7X6VAC2NHK2DK3H6R5IGF7",
    "Domestic Cleaning": "01HRAU3CJNFG44TQSQ5RBJOKXJNO7MGHHQ",
    "End Of Tenancy Cleaning": "01HRAU3CMT64WNWGRAENAJ4KECYBFO4Y6C",
  };

  const folderId = serviceFolders[serviceName];
  if (!folderId) {
    throw new Error(`Service folder not found for: ${serviceName}`);
  }
  return folderId;
}

// Helper Function: Create/Get Folder
async function createOrGetFolder(parentFolderId, folderName) {
  const url = `https://graph.microsoft.com/v1.0/drive/items/${parentFolderId}/children`;

  // Check if the folder already exists
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  const existingFolder = data.value.find((item) => item.name === folderName);

  if (existingFolder) {
    return existingFolder.id;
  }

  // Create the folder
  const createResponse = await fetch(url, {
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

  const createData = await createResponse.json();
  return createData.id;
}

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

// Helper Function to upload file to OneDrive
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
