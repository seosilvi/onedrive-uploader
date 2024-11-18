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

// Token Management
let accessToken = process.env.ACCESS_TOKEN;
let refreshToken = process.env.REFRESH_TOKEN;
let tokenExpiryTime = Date.now() + 3600 * 1000; // Default expiry set for 1 hour from now

async function refreshAccessToken() {
  const url = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const body = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    redirect_uri: process.env.REDIRECT_URI,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to refresh token:", errorText);
      throw new Error("Token refresh failed.");
    }

    const data = await response.json();
    console.log("Token refreshed successfully:", data);

    // Update tokens and expiry
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    tokenExpiryTime = Date.now() + data.expires_in * 1000;

    // Optionally, update environment variables or storage
    process.env.ACCESS_TOKEN = accessToken;
    process.env.REFRESH_TOKEN = refreshToken;

    return accessToken;
  } catch (error) {
    console.error("Error refreshing access token:", error.message);
    throw error;
  }
}

async function getValidAccessToken() {
  if (Date.now() >= tokenExpiryTime) {
    console.log("Access token expired. Refreshing...");
    return await refreshAccessToken();
  }
  return accessToken;
}

// Service folder mapping with lowercase keys
const serviceFolderMapping = {
  "airbnb cleaning": "01HRAU3CKVL2NOUI3KNZFIMQGWF2W6I6KE",
  "domestic cleaning": "01HRAU3CJNFG44TQSQ5RBJOKXJNO7MGHHQ",
  "end of tenancy cleaning": "01HRAU3CMT64WNWGRAENAJ4KECYBFO4Y6C",
  "after builders cleaning": "01HRAU3CIERAXDQ73IJFDLT73OV7WR2HIM",
  "commercial cleaning": "01HRAU3CMUE53HAO7J6BGJFN64XZMQQEUB",
  "deep house cleaning": "01HRAU3CMX5K7X6VAC2NHK2DK3H6R5IGF7",
  "carpet cleaning": "01HRAU3CJJ7PDR5EP5GRHKHVAC7RQRA3NG",
};

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

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
    const token = await getValidAccessToken();
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
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
    const token = await getValidAccessToken();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
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

async function uploadToOneDrive(filePath, folderId, filename) {
  const url = `https://graph.microsoft.com/v1.0/drive/items/${folderId}:/${filename}:/content`;

  try {
    const token = await getValidAccessToken();
    const fileStream = fs.createReadStream(filePath);
    console.log(`Uploading file: ${filename} to folder ID: ${folderId}`);

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
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

app.post("/batch-upload", upload.array("files", 200), async (req, res) => {
  try {
    const { tag, postcode, form_name, frontly_id } = req.body;
    const files = req.files;

    if (!files || files.length === 0 || !postcode || !form_name || !frontly_id) {
      return res.status(400).json({
        error: "Files, postcode, form_name, and frontly_id are required.",
      });
    }

    console.log(`Received form_name: "${form_name}"`);
    const geolocation = await getGeolocationFromPostcode(postcode);
    if (!geolocation) {
      return res
        .status(400)
        .json({ error: "Failed to fetch geolocation for the provided postcode." });
    }

    const date = new Date().toISOString().split("T")[0];
    const folderName = `${postcode}_${date}`;

    const parentFolderId = serviceFolderMapping[form_name.trim().toLowerCase()];
    if (!parentFolderId) {
      console.error(`No folder mapping found for form_name: "${form_name}"`);
      return res
        .status(400)
        .json({ error: `No mapped folder ID found for form_name: "${form_name}"` });
    }

    const mainFolderId = await createOrGetFolder(parentFolderId, folderName);
    const subfolderName = tag.toLowerCase() === "before" ? "before" : "after";
    const subfolderId = await createOrGetFolder(mainFolderId, subfolderName);

    const uploadedFiles = [];

    for (const file of files) {
      const filePath = path.resolve(file.path);
      const filename = `SN_Cleaning_${tag}_${Date.now()}_${file.originalname}`;
      const uploadResult = await uploadToOneDrive(filePath, subfolderId, filename);

      if (uploadResult) {
        uploadedFiles.push({ file: file.originalname, url: uploadResult });
      }

      fs.unlinkSync(file.path);
    }

    res.status(200).json({ message: "All files uploaded successfully", files: uploadedFiles });
  } catch (error) {
    console.error("Error in /batch-upload endpoint:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

process.on("exit", () => exiftool.end());
