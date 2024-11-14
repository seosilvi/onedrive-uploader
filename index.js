const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const previewContainer = document.getElementById('previewContainer');
const spinnerOverlay = document.getElementById('spinnerOverlay');

// Parsing URL Parameters
const urlParams = new URLSearchParams(window.location.search);
const postcode = urlParams.get('postcode');
const frontly_id = urlParams.get('frontly_id');
const form_name = urlParams.get('form_name');

console.log("URL Parameters:", { postcode, frontly_id, form_name }); // Debugging

let selectedTag = '';

// Event listeners for selecting "Before" or "After"
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

// Display file previews
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

// Upload function with error handling
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

        console.log("Uploading file:", files[i].name); // Debugging

        try {
            const response = await fetch(`https://onedrive-uploader.onrender.com/upload?postcode=${postcode}&frontly_id=${frontly_id}&form_name=${form_name}`, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                console.log(`File ${i + 1} uploaded successfully.`);
            } else {
                const errorText = await response.text();
                console.error(`Failed to upload file ${i + 1}. Server response:`, errorText);
            }
        } catch (error) {
            console.error(`Error uploading file ${i + 1}:`, error);
        }
    }

    spinnerOverlay.style.visibility = 'hidden';
    previewContainer.innerHTML = '';
});
