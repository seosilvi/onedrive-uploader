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

app.use(cors({ origin: "https://sncleaningservices.co.uk" }));
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
    console.log("Access token refreshed successfully.");
    return true;
  } else {
    console.error("Failed to refresh access token:", data);
    return false;
  }
}

async function getGeolocationFromPostcode(postcode) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(postcode)}&key=${GOOGLE_MAPS_API_KEY}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "OK" && data.results.length > 0) {
      const { lat, lng } = data.results[0].geometry.location;
      console.log(`Geolocation for postcode ${postcode}: Latitude ${lat}, Longitude ${lng}`);
      return { latitude: lat, longitude: lng };
    } else {
      console.error(`Failed to get geolocation for postcode ${postcode}:`, data);
      return null;
    }
  } catch (error) {
    console.error("Error fetching geolocation:", error);
    return null;
  }
}

async function createOrGetFolder(parentId, folderName) {
  const url = `https://graph.microsoft.com/v1.0/drive/items/${parentId}/children`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` },
    });

    const data = await response.json();

    if (Array.isArray(data.value)) {
      const folder = data.value.find((item) => item.name === folderName && item.folder);
      if (folder) {
        console.log(`Found folder: ${folderName}`);
        return folder.id;
      }
    }

    console.log(`Folder ${folderName} not found. Creating it...`);
    return await createFolder(parentId, folderName);
  } catch (error) {
    console.error("Error in createOrGetFolder:", error.message);
    throw error;
  }
}

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
    console.error("Error creating folder:", error.message);
    throw error;
  }
}

async function addGeolocationToImage(filePath, latitude, longitude) {
  try {
    // Modify the original file with geolocation metadata
    await exiftool.write(filePath, {
      GPSLatitude: latitude,
      GPSLongitude: longitude,
      GPSLatitudeRef: latitude >= 0 ? "N" : "S",
      GPSLongitudeRef: longitude >= 0 ? "E" : "W",
    });
    console.log(`Geolocation metadata added directly to file: ${filePath}`);
    return filePath; // Return the original file path
  } catch (error) {
    console.error("Error adding geolocation to image:", error.message);
    return null;
  }
}

async function uploadToOneDrive(filePath, folderId, filename) {
  const url = `https://graph.microsoft.com/v1.0/drive/items/${folderId}:/${filename}:/content`;

  try {
    const fileStream = fs.createReadStream(filePath);
    console.log(`Uploading file: ${filename} to folder ID: ${folderId}`);

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/octet-stream",
      },
      body: fileStream,
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`File uploaded successfully: ${data.webUrl}`);
      return data.webUrl;
    } else {
      console.error("Error uploading file to OneDrive:", data);
      throw new Error(`Upload failed: ${data.error.message}`);
    }
  } catch (error) {
    console.error("Error in uploadToOneDrive:", error.message);
    throw error;
  }
}

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { tag, postcode, form_name } = req.body;
    const file = req.file;

    if (!file || !postcode || !form_name) {
      return res.status(400).json({ error: "File, postcode, and form_name are required." });
    }

    const geolocation = await getGeolocationFromPostcode(postcode);
    if (!geolocation) {
      return res.status(400).json({ error: "Failed to fetch geolocation for the provided postcode." });
    }

    const date = new Date().toISOString().split("T")[0];
    const folderName = `${postcode}_${date}`;
    const filePath = path.resolve(file.path);
    const filename = `SN_Cleaning_${tag}_${Date.now()}_${file.originalname}`;

    const parentFolderId = serviceFolderMapping[form_name.trim()];
    if (!parentFolderId) {
      return res.status(400).json({ error: `No mapped folder ID found for form_name: "${form_name}"` });
    }

    const mainFolderId = await createOrGetFolder(parentFolderId, folderName);

    // Create or Get Subfolder (before/after)
    const subfolderName = tag.toLowerCase() === "before" ? "before" : "after";
    const subfolderId = await createOrGetFolder(mainFolderId, subfolderName);

    // Add geolocation metadata to the original file
    const updatedFilePath = await addGeolocationToImage(filePath, geolocation.latitude, geolocation.longitude);
    if (!updatedFilePath) {
      return res.status(500).json({ error: "Failed to add geolocation metadata." });
    }

    // Upload the updated file to OneDrive
    const uploadResult = await uploadToOneDrive(updatedFilePath, subfolderId, filename);
    if (uploadResult) {
      res.status(200).json({ message: "Uploaded successfully", url: uploadResult });
    } else {
      res.status(500).json({ error: "Failed to upload to OneDrive" });
    }
  } catch (error) {
    console.error("Error in /upload endpoint:", error.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    if (req.file && req.file.path) {
      fs.unlinkSync(req.file.path); // Clean up temporary file
    }
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

process.on("exit", () => exiftool.end());
