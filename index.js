// Existing imports and setup remain the same

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

// Function to create or get a folder remains unchanged
async function createOrGetFolder(parentId, folderName) {
  const url = `https://graph.microsoft.com/v1.0/drive/items/${parentId}/children`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
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

// Rest of the code remains unchanged
