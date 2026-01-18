const fileInput = document.getElementById("fileInput");
const toleranceInput = document.getElementById("tolerance");
const toleranceValue = document.getElementById("toleranceValue");
const dropArea = document.getElementById("dropArea");
const trimPreview = document.getElementById("trimPreview");
const trimMeta = document.getElementById("trimMeta");
const downloadBtn = document.getElementById("downloadBtn");
const message = document.getElementById("message");

let trimmedDataUrl = null;
let trimmedFilename = null;
let latestImage = null;

const setMessage = (text) => {
  message.textContent = text;
};

const resetState = () => {
  origPreview.removeAttribute("src");
  trimPreview.removeAttribute("src");
  trimMeta.textContent = "-";
  trimmedDataUrl = null;
  trimmedFilename = null;
  latestImage = null;
  downloadBtn.disabled = true;
  setMessage("");
};

const formatSize = (width, height) => `${width} × ${height}px`;

const loadImageFromFile = (file) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像の読み込みに失敗しました。"));
    };
    img.src = url;
  });
};

const detectBackground = (data, width, height, alphaThreshold) => {
  const buckets = new Map();
  let borderCount = 0;
  let transparentCount = 0;

  const addColor = (r, g, b) => {
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, r: 0, g: 0, b: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
  };

  const sample = (x, y) => {
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    borderCount += 1;
    if (a <= alphaThreshold) {
      transparentCount += 1;
      return;
    }
    addColor(r, g, b);
  };

  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    sample(0, y);
    sample(width - 1, y);
  }

  const transparentRatio = borderCount === 0 ? 1 : transparentCount / borderCount;
  const bgIsTransparent = transparentRatio > 0.5;

  if (bgIsTransparent || buckets.size === 0) {
    return { transparent: true, color: { r: 255, g: 255, b: 255 } };
  }

  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) {
      best = bucket;
    }
  }

  const color = {
    r: Math.round(best.r / best.count),
    g: Math.round(best.g / best.count),
    b: Math.round(best.b / best.count),
  };

  return { transparent: false, color };
};

const findTrimBounds = (image, tolerance) => {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const alphaThreshold = 8;
  const bg = detectBackground(data, canvas.width, canvas.height, alphaThreshold);
  const tol = Number(tolerance);
  const tolSquared = tol * tol * 3;

  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const idx = (y * canvas.width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      let isBackground = false;
      if (bg.transparent) {
        isBackground = a <= alphaThreshold;
      } else if (a <= alphaThreshold) {
        isBackground = true;
      } else {
        const dr = r - bg.color.r;
        const dg = g - bg.color.g;
        const db = b - bg.color.b;
        const diff = dr * dr + dg * dg + db * db;
        isBackground = diff <= tolSquared;
      }

      if (!isBackground) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

const trimImage = async (file, tolerance) => {
  const img = await loadImageFromFile(file);
  latestImage = img;
  const bounds = findTrimBounds(img, tolerance);
  if (!bounds) {
    trimmedDataUrl = null;
    trimmedFilename = null;
    trimPreview.removeAttribute("src");
    trimMeta.textContent = "-";
    downloadBtn.disabled = true;
    setMessage("余白以外が見つかりませんでした。許容誤差を調整してください。");
    return;
  }

  const output = document.createElement("canvas");
  output.width = bounds.width;
  output.height = bounds.height;
  const outCtx = output.getContext("2d");
  outCtx.drawImage(
    img,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );

  trimmedDataUrl = output.toDataURL("image/png");
  trimPreview.src = trimmedDataUrl;
  trimMeta.textContent = `${formatSize(bounds.width, bounds.height)} / トリミング`;
  trimmedFilename = `${file.name.replace(/\.[^/.]+$/, "")}--trim.png`;
  downloadBtn.disabled = false;
  setMessage("");
};

toleranceInput.addEventListener("input", () => {
  toleranceValue.textContent = toleranceInput.value;
  if (fileInput.files && fileInput.files[0]) {
    trimImage(fileInput.files[0], toleranceInput.value).catch((err) => {
      setMessage(err.message);
    });
  }
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    resetState();
    return;
  }

  trimImage(file, toleranceInput.value).catch((err) => {
    setMessage(err.message);
  });
});

const handleDroppedFile = (file) => {
  if (!file) return;
  trimImage(file, toleranceInput.value).catch((err) => {
    setMessage(err.message);
  });
};

const setDragState = (isDragging) => {
  dropArea.classList.toggle("is-dragging", isDragging);
};

["dragenter", "dragover"].forEach((eventName) => {
  dropArea.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragState(true);
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropArea.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragState(false);
  });
});

dropArea.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
    } catch (err) {
      // Ignore if DataTransfer is not available; we still handle the file directly.
    }
  }
  handleDroppedFile(file);
});

downloadBtn.addEventListener("click", () => {
  if (!trimmedDataUrl) return;
  const link = document.createElement("a");
  link.href = trimmedDataUrl;
  link.download = trimmedFilename || "trimmed.png";
  link.click();
});

resetState();
