const fileInput = document.getElementById("fileInput");
const toleranceInput = document.getElementById("tolerance");
const toleranceValue = document.getElementById("toleranceValue");
const dropArea = document.getElementById("dropArea");
const results = document.getElementById("results");
const countMeta = document.getElementById("countMeta");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const clearBtn = document.getElementById("clearBtn");
const message = document.getElementById("message");

let trimmedItems = [];

const setMessage = (text) => {
  message.textContent = text;
};

const dataUrlToBase64 = (dataUrl) => {
  const parts = dataUrl.split(",");
  return parts.length > 1 ? parts[1] : "";
};

const getUniqueFilename = (filename, usedNames) => {
  if (!usedNames.has(filename)) {
    usedNames.add(filename);
    return filename;
  }

  const match = filename.match(/^(.*?)(\.[^.]*)?$/);
  const base = match ? match[1] : filename;
  const ext = match && match[2] ? match[2] : "";
  let index = 2;
  let nextName = `${base} (${index})${ext}`;
  while (usedNames.has(nextName)) {
    index += 1;
    nextName = `${base} (${index})${ext}`;
  }
  usedNames.add(nextName);
  return nextName;
};

const renderEmptyState = () => {
  results.innerHTML = '<div class="empty-state">ここに結果が表示されます。</div>';
};

const resetState = () => {
  results.innerHTML = "";
  renderEmptyState();
  countMeta.textContent = "0件";
  trimmedItems = [];
  downloadAllBtn.disabled = true;
  clearBtn.disabled = true;
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
  const bounds = findTrimBounds(img, tolerance);
  if (!bounds) {
    return null;
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

  const trimmedDataUrl = output.toDataURL("image/png");
  const trimmedFilename = `${file.name.replace(/\.[^/.]+$/, "")}.png`;

  return {
    dataUrl: trimmedDataUrl,
    filename: trimmedFilename,
    width: bounds.width,
    height: bounds.height,
  };
};

const createResultCard = (item) => {
  const card = document.createElement("div");
  card.className = "result-card";

  const preview = document.createElement("div");
  preview.className = "result-preview";
  const img = document.createElement("img");
  img.src = item.dataUrl;
  img.alt = `${item.filename} preview`;
  preview.appendChild(img);

  const name = document.createElement("div");
  name.className = "result-meta";
  name.textContent = item.filename;

  const size = document.createElement("div");
  size.className = "result-meta";
  size.textContent = formatSize(item.width, item.height);

  const actions = document.createElement("div");
  actions.className = "result-actions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost btn-small";
  button.textContent = "ダウンロード";
  button.addEventListener("click", () => {
    downloadFile(item.dataUrl, item.filename);
  });
  actions.appendChild(button);

  card.appendChild(preview);
  card.appendChild(name);
  card.appendChild(size);
  card.appendChild(actions);

  return card;
};

const downloadFile = (dataUrl, filename) => {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
};

const processFiles = async (files) => {
  if (!files.length) {
    resetState();
    return;
  }

  results.innerHTML = "";
  trimmedItems = [];
  countMeta.textContent = "0件";
  downloadAllBtn.disabled = true;
  clearBtn.disabled = false;
  setMessage("トリミング中...");

  let failedCount = 0;
  for (const file of files) {
    try {
      const trimmed = await trimImage(file, toleranceInput.value);
      if (!trimmed) {
        failedCount += 1;
        continue;
      }
      const item = {
        file,
        ...trimmed,
      };
      trimmedItems.push(item);
      results.appendChild(createResultCard(item));
      countMeta.textContent = `${trimmedItems.length}件`;
    } catch (err) {
      failedCount += 1;
    }
  }

  if (trimmedItems.length === 0) {
    renderEmptyState();
  }

  downloadAllBtn.disabled = trimmedItems.length === 0;

  if (failedCount > 0 && trimmedItems.length > 0) {
    setMessage(`一部の画像はトリミングできませんでした（${failedCount}件）。`);
  } else if (failedCount > 0) {
    setMessage("余白以外が見つかりませんでした。許容誤差を調整してください。");
  } else {
    setMessage("");
  }
};

toleranceInput.addEventListener("input", () => {
  toleranceValue.textContent = toleranceInput.value;
  if (fileInput.files && fileInput.files.length > 0) {
    processFiles(Array.from(fileInput.files));
  }
});

fileInput.addEventListener("change", () => {
  const files = fileInput.files ? Array.from(fileInput.files) : [];
  processFiles(files);
});

const handleDroppedFile = (file) => {
  if (!file) return;
  processFiles([file]);
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
  const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
  if (files.length > 0) {
    try {
      const dataTransfer = new DataTransfer();
      files.forEach((file) => dataTransfer.items.add(file));
      fileInput.files = dataTransfer.files;
    } catch (err) {
      // Ignore if DataTransfer is not available; we still handle the file directly.
    }
  }
  if (files.length === 1) {
    handleDroppedFile(files[0]);
  } else if (files.length > 1) {
    processFiles(files);
  }
});

downloadAllBtn.addEventListener("click", () => {
  if (trimmedItems.length === 0) return;
  setMessage("ZIPを作成中...");
  const zip = new JSZip();
  const usedNames = new Set();

  trimmedItems.forEach((item) => {
    const filename = getUniqueFilename(item.filename, usedNames);
    const base64 = dataUrlToBase64(item.dataUrl);
    zip.file(filename, base64, { base64: true });
  });

  zip
    .generateAsync({ type: "blob" })
    .then((content) => {
      const url = URL.createObjectURL(content);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      link.href = url;
      link.download = `trimmed-images-${timestamp}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("ZIPダウンロードを開始しました。");
    })
    .catch(() => {
      setMessage("ZIPの作成に失敗しました。");
    });
});

clearBtn.addEventListener("click", () => {
  fileInput.value = "";
  resetState();
});

resetState();
