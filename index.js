<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Upload Photos to OneDrive</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/piexifjs"></script>
    <style>
        /* Styling omitted for brevity */
    </style>
</head>
<body>
    <div class="upload-container">
        <h1>Upload Photos</h1>
        <div class="title">Choose the type of photos</div>
        <div class="upload-options">
            <div class="option" id="beforeOption">Before</div>
            <div class="option" id="afterOption">After</div>
        </div>
        <label for="fileInput" class="file-input-label">Choose Files</label>
        <input type="file" id="fileInput" multiple accept="image/jpeg">
        <div class="preview-container" id="previewContainer"></div>
        <button id="uploadBtn" class="upload-btn">Upload Photos</button>
        <div class="spinner-overlay" id="spinnerOverlay">Uploading images...</div>
    </div>

    <script>
        const uploadBtn = document.getElementById('uploadBtn');
        const fileInput = document.getElementById('fileInput');
        const previewContainer = document.getElementById('previewContainer');
        const spinnerOverlay = document.getElementById('spinnerOverlay');
        
        // Parsing URL Parameters
        const urlParams = new URLSearchParams(window.location.search);
        const postcode = urlParams.get('postcode');
        const frontly_id = urlParams.get('frontly_id');
        const form_name = urlParams.get('form_name');
        
        console.log("URL Parameters:", { postcode, frontly_id, form_name });

        let selectedTag = '';

        document.getElementById('beforeOption').addEventListener('click', () => {
            selectedTag = 'before';
            document.getElementById('beforeOption').classList.add('selected');
            document.getElementById('afterOption').classList.remove('selected');
            console.log("Selected Tag:", selectedTag);
        });

        document.getElementById('afterOption').addEventListener('click', () => {
            selectedTag = 'after';
            document.getElementById('afterOption').classList.add('selected');
            document.getElementById('beforeOption').classList.remove('selected');
            console.log("Selected Tag:", selectedTag);
        });

        fileInput.addEventListener('change', () => {
            previewContainer.innerHTML = '';
            Array.from(fileInput.files).forEach(file => {
                const previewItem = document.createElement('div');
                previewItem.classList.add('preview-item');
                const img = document.createElement('img');
                img.src = URL.createObjectURL(file);
                img.onload = () => URL.revokeObjectURL(img.src);
                previewItem.appendChild(img);
                previewContainer.appendChild(previewItem);
            });
        });

        uploadBtn.addEventListener('click', async () => {
            const files = fileInput.files;
            if (files.length === 0 || !selectedTag || !postcode) {
                alert("Select files, type, and postcode");
                return;
            }

            spinnerOverlay.style.visibility = 'visible';

            for (let i = 0; i < files.length; i++) {
                const formData = new FormData();
                formData.append("file", files[i]);
                formData.append("tag", selectedTag);
                formData.append("latitude", 51.5074);  // Example latitude
                formData.append("longitude", -0.1278); // Example longitude

                console.log("Uploading file:", files[i].name);

                try {
                    const response = await fetch(`https://onedrive-uploader.onrender.com/upload?postcode=${postcode}&frontly_id=${frontly_id}&form_name=${form_name}`, {
                        method: 'POST',
                        body: formData
                    });

                    if (response.ok) {
                        console.log(`File ${i + 1} uploaded successfully.`);
                    } else {
                        console.error(`Failed to upload file ${i + 1}.`, await response.text());
                    }
                } catch (error) {
                    console.error(`Error uploading file ${i + 1}:`, error);
                }
            }

            spinnerOverlay.style.visibility = 'hidden';
            previewContainer.innerHTML = '';
        });
    </script>
</body>
</html>
