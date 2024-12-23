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
let accessToken = null; // Initially null
let tokenExpiryTime = 0; // Initially set to 0 (expired)

// Function to refresh the access token using the `client_credentials` flow
async function refreshAccessToken() {
    const url = "https://login.microsoftonline.com/f2aa74e3-a9a8-428f-9240-1933ed98e1e1/oauth2/v2.0/token";
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
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

        // Update access token and expiry time
        accessToken = data.access_token;
        tokenExpiryTime = Date.now() + data.expires_in * 1000;

        return accessToken;
    } catch (error) {
        console.error("Error refreshing access token:", error.message);
        throw error;
    }
}

// Function to get a valid access token, refreshing it if expired
async function getValidAccessToken() {
    console.log("Current time:", new Date().toISOString());
    console.log("Token expiry time:", new Date(tokenExpiryTime).toISOString());

    if (!accessToken || Date.now() >= tokenExpiryTime) {
        console.log("Access token is missing or expired. Refreshing...");
        try {
            return await refreshAccessToken();
        } catch (error) {
            console.error("Failed to refresh access token:", error.message);
            throw error;
        }
    }

    console.log("Using valid access token.");
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
        console.log("Using access token:", token);

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

        console.log(`Microsoft Response Status: ${response.status}`);
        console.log("Response Headers:", response.headers.raw());

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error creating folder: ${errorText}`);
            throw new Error(`Failed to create folder. Status: ${response.status}, Response: ${errorText}`);
        }

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

async function sendAllToAlbatoWebhook(frontly_id, postcode, uploadedFiles) {
    const webhookUrl = "https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTZjMDYzZTA0MzQ1MjY4NTUzYzUxMzYi_pc";

    try {
        const payload = {
            frontly_id: frontly_id,
            postcode: postcode,
            files: uploadedFiles, // Send all files at once
        };

        console.log("Sending data to Albato webhook:", payload);

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            console.log("Webhook sent to Albato successfully.");
        } else {
            console.error("Failed to send webhook to Albato. Response:", await response.text());
        }
    } catch (error) {
        console.error("Error sending data to Albato webhook:", error.message);
    }
}

async function uploadToOneDrive(filePath, folderId, filename) {
    const url = `https://graph.microsoft.com/v1.0/drive/items/${folderId}:/${filename}:/content`;

    try {
        const token = await getValidAccessToken();
        const fileStream = fs.createReadStream(filePath);
        console.log(`Uploading file: ${filename} to folder ID: ${folderId}`);

        // Upload the file
        const response = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/octet-stream",
            },
            body: fileStream,
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Error uploading file to OneDrive:", data);
            throw new Error(`Upload failed: ${data.error.message}`);
        }

        console.log(`File uploaded successfully: ${data.webUrl}`);

        // Generate a shared link for the file
        const sharedLinkUrl = `https://graph.microsoft.com/v1.0/drive/items/${data.id}/createLink`;
        const shareResponse = await fetch(sharedLinkUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ type: "view", scope: "anonymous" }),
        });

        const shareData = await shareResponse.json();
        if (!shareResponse.ok || !shareData.link || !shareData.link.webUrl) {
            console.error("Error generating shared link:", shareData);
            throw new Error("Failed to generate shared link for the file.");
        }

        console.log(`Shared link generated: ${shareData.link.webUrl}`);

        // Return the shared URL instead of the internal OneDrive URL
        return shareData.link.webUrl;

    } catch (error) {
        console.error("Error in uploadToOneDrive:", error.message);
        throw error;
    }
}


async function sendToPabblyWebhook(frontly_id, postcode, folderUrl) {
    const webhookUrl = "https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTZjMDYzMTA0M2M1MjZjNTUzMzUxMzEi_pc";

    try {
        const payload = {
            frontly_id: frontly_id,
            postcode: postcode,
            folder_url: folderUrl,
        };

        console.log("Sending data to Pabbly webhook:", payload);

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            console.log("Webhook sent successfully.");
        } else {
            console.error("Failed to send webhook. Response:", await response.text());
        }
    } catch (error) {
        console.error("Error sending data to Pabbly webhook:", error.message);
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
            return res.status(400).json({ error: "Failed to fetch geolocation for the provided postcode." });
        }

        const date = new Date().toISOString().split("T")[0];
        const folderName = `${postcode}_${date}`;

        const parentFolderId = serviceFolderMapping[form_name.trim().toLowerCase()];
        if (!parentFolderId) {
            console.error(`No folder mapping found for form_name: "${form_name}"`);
            return res.status(400).json({ error: `No mapped folder ID found for form_name: "${form_name}"` });
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

        await sendAllToAlbatoWebhook(frontly_id, postcode, uploadedFiles);

        // Generate shared folder link for the main folder
        const shareResponse = await fetch(
            `https://graph.microsoft.com/v1.0/drive/items/${mainFolderId}/createLink`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ type: "view", scope: "anonymous" }),
            }
        );

        const shareData = await shareResponse.json();
        if (!shareData.link || !shareData.link.webUrl) {
            throw new Error("Failed to generate shared folder URL.");
        }
        const sharedFolderUrl = shareData.link.webUrl;

        // Call Pabbly webhook with the shared folder link
        await sendToPabblyWebhook(frontly_id, postcode, sharedFolderUrl);

        console.log("Webhook sent to Pabbly with shared folder URL.");

        res.status(200).json({
            message: "All files uploaded successfully",
            files: uploadedFiles, // Include shared links for individual files
            sharedFolderUrl, // Include the shared folder link in response
        });
    } catch (error) {
        console.error("Error in /batch-upload endpoint:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

process.on("exit", () => exiftool.end());

