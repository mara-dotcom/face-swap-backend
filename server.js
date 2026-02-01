import express from "express";
import multer from "multer";
import fs from "fs";
import Replicate from "replicate";
import cors from "cors";

// =====================
// APP SETUP
// =====================
const app = express();
const upload = multer({ dest: "uploads/" });

// ✅ Allow requests from any website
app.use(cors());

// Serve generated images
app.use("/outputs", express.static("outputs"));

// =====================
// REPLICATE CLIENT
// =====================
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN
});

// =====================
// HELPERS
// =====================

// Convert file → base64 data URL
function toDataURL(filePath) {
  const buffer = fs.readFileSync(filePath);
  return "data:image/jpeg;base64," + buffer.toString("base64");
}

// Convert ReadableStream → Buffer
async function streamToBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

// =====================
// SWAP ROUTE
// =====================
app.post(
  "/swap",
  upload.fields([
    { name: "face", maxCount: 1 },
    { name: "body", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      console.log("FILES:", req.files);

      if (!req.files?.face || !req.files?.body) {
        return res.status(400).json({
          error: "Both face and body images are required"
        });
      }

      const facePath = req.files.face[0].path;
      const bodyPath = req.files.body[0].path;

      const faceImage = toDataURL(facePath);
      const bodyImage = toDataURL(bodyPath);

      const prompt = `
Create one realistic image using the face from the first image and the body from the second image.
Add and clearly show the face on the body.
Make the body proportions natural and correctly scaled to the face.
Ensure the final image looks realistic, well aligned, and seamless.
`;

      const output = await replicate.run(
        "qwen/qwen-image-edit-plus",
        {
          input: {
            image: [faceImage, bodyImage],
            prompt: prompt
          }
        }
      );

      console.log("QWEN OUTPUT:", output);

      // Cleanup uploaded files
      fs.unlinkSync(facePath);
      fs.unlinkSync(bodyPath);

      if (!Array.isArray(output) || output.length === 0) {
        return res.status(500).json({
          error: "Model returned no output"
        });
      }

      // Convert stream to image file
      const buffer = await streamToBuffer(output[0]);

      fs.mkdirSync("outputs", { recursive: true });
      const fileName = `result_${Date.now()}.jpg`;
      const outputPath = `outputs/${fileName}`;
      fs.writeFileSync(outputPath, buffer);

      // ✅ ABSOLUTE URL FIX
      const baseUrl = `${req.protocol}://${req.get("host")}`;

      res.json({
        image: `${baseUrl}/${outputPath}`
      });

    } catch (err) {
      console.error("SERVER ERROR:", err);
      res.status(500).json({
        error: err.message || "Image generation failed"
      });
    }
  }
);

// =====================
// START SERVER
// =====================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
