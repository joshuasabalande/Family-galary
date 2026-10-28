/* ==========================================================================
   Photo Gallery
   - Shared photos: every image in the "images" folder (visible to everyone)
   - Your uploads: saved in this browser only (IndexedDB)
   ========================================================================== */

(function () {
  "use strict";


  /* ---------- Settings ---------------------------------------------------- */

  // Only needed if your site is NOT on github.io (it is detected automatically there).
  var CONFIG = {
    user: "",
    repo: "",
    folder: "images",

    // Cloudinary (optional): lets EVERYONE upload photos that everyone can see.
    // Leave both empty to keep uploads on the visitor's device only.
    cloudName: "",        // e.g. "demo-cloud"
    uploadPreset: "",     // an UNSIGNED upload preset, e.g. "gallery_upload"
    tag: "gallery"        // photos are grouped by this tag
  };

  var MAX_SIZE = 1800;      // Uploaded photos are shrunk to this many pixels
  var JPEG_QUALITY = 0.88;


  /* ---------- State ------------------------------------------------------- */

  var shared = [];          // Photos from the images folder
  var cloud = [];           // Photos uploaded to Cloudinary (seen by everyone)
  var photos = [];          // Photos uploaded on this device
  var favs = {};            // Favorites of shared photos, kept in localStorage
  var view = [];            // Photos currently shown (after search / filter / sort)
  var urls = {};            // Object URLs for uploaded photos
  var db = null;
  var index = -1;           // Position in the viewer
  var newestFirst = true;
  var favOnly = false;
  var zoomed = false;
  var touchStartX = null;


  /* ---------- Helpers ----------------------------------------------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function allPhotos() {
    return shared.concat(cloud, photos);
  }

  function showToast(message) {
    var toast = $("toast");

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      toast.classList.remove("show");
    }, 2200);
  }

  function niceName(fileName) {
    return fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim();
  }

  function photoUrl(photo) {
    if (photo.src) {
      return photo.src;
    }

    if (!urls[photo.id]) {
      urls[photo.id] = URL.createObjectURL(photo.blob);
    }

    return urls[photo.id];
  }


  /* ---------- Favorites (shared photos) ----------------------------------- */

  function loadFavs() {
    try {
      favs = JSON.parse(localStorage.getItem("gallery-favs") || "{}");
    } catch (error) {
      favs = {};
    }
  }

  function saveFavs() {
    try {
      localStorage.setItem("gallery-favs", JSON.stringify(favs));
    } catch (error) {
      // Storage unavailable: favorites just won't be remembered.
    }
  }

  function toggleFav(photo) {
    photo.fav = !photo.fav;

    if (photo.shared) {
      if (photo.fav) {
        favs[photo.id] = 1;
      } else {
        delete favs[photo.id];
      }
      saveFavs();
    } else {
      dbPut(photo);
    }

    render();

    if ($("lb").classList.contains("open")) {
      syncViewer();
    }
  }


  /* ---------- Storage for uploads (IndexedDB) ----------------------------- */

  function openDB() {
    return new Promise(function (resolve) {
      try {
        var request = indexedDB.open("photo-gallery", 1);

        request.onupgradeneeded = function () {
          request.result.createObjectStore("photos", { keyPath: "id" });
        };
        request.onsuccess = function () {
          db = request.result;
          resolve();
        };
        request.onerror = function () {
          resolve();
        };
      } catch (error) {
        resolve();
      }
    });
  }

  function dbAll() {
    return new Promise(function (resolve) {
      if (!db) {
        return resolve([]);
      }

      try {
        var request = db.transaction("photos").objectStore("photos").getAll();

        request.onsuccess = function () {
          resolve(request.result || []);
        };
        request.onerror = function () {
          resolve([]);
        };
      } catch (error) {
        resolve([]);
      }
    });
  }

  function dbPut(photo) {
    if (!db) {
      return;
    }

    try {
      db.transaction("photos", "readwrite").objectStore("photos").put(photo);
    } catch (error) {
      // Ignore: photo stays in memory for this visit.
    }
  }

  function dbDelete(id) {
    if (!db) {
      return;
    }

    try {
      db.transaction("photos", "readwrite").objectStore("photos").delete(id);
    } catch (error) {
      // Ignore.
    }
  }

  function dbClear() {
    if (!db) {
      return;
    }

    try {
      db.transaction("photos", "readwrite").objectStore("photos").clear();
    } catch (error) {
      // Ignore.
    }
  }


  /* ---------- Shared photos (images folder) ------------------------------- */

  function setShared(list) {
    shared = list.map(function (item, i) {
      var file = typeof item === "string" ? item : item.file;
      var id = "s-" + file;

      return {
        id: id,
        name: file,
        caption: (item && item.caption) || niceName(file),
        fav: !!favs[id],
        added: i,
        src: CONFIG.folder + "/" + encodeURIComponent(file),
        shared: true
      };
    });
  }

  function loadShared() {
    var host = location.hostname;
    var segment = location.pathname.split("/")[1] || "";
    var onGithub = /\.github\.io$/.test(host);

    var user = CONFIG.user || (onGithub ? host.split(".")[0] : "");
    var repo = CONFIG.repo || (onGithub ? (segment && segment.indexOf(".") < 0 ? segment : host) : "");
    var isImage = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

    // 1. Ask GitHub which files are in the images folder
    var fromApi = Promise.resolve([]);

    if (user && repo) {
      fromApi = fetch("https://api.github.com/repos/" + user + "/" + repo + "/contents/" + CONFIG.folder)
        .then(function (response) {
          if (!response.ok) {
            throw new Error("GitHub API unavailable");
          }
          return response.json();
        })
        .then(function (rows) {
          return rows
            .filter(function (row) {
              return row.type === "file" && isImage.test(row.name);
            })
            .map(function (row) {
              return row.name;
            });
        });
    }

    return fromApi
      .catch(function () {
        return [];
      })
      .then(function (list) {
        if (list.length) {
          return list;
        }

        // 2. Fall back to the photos.json list
        return fetch("photos.json")
          .then(function (response) {
            return response.ok ? response.json() : [];
          })
          .catch(function () {
            return [];
          });
      })
      .then(setShared);
  }


  /* ---------- Cloudinary (photos everyone can upload and see) ------------- */

  function cloudOn() {
    return !!(CONFIG.cloudName && CONFIG.uploadPreset);
  }

  function cloudPhoto(item) {
    var base = "https://res.cloudinary.com/" + CONFIG.cloudName + "/image/upload/";
    var path = "v" + item.version + "/" + item.public_id + "." + item.format;
    var fileName = item.public_id.split("/").pop();
    var context = item.context && (item.context.custom || item.context);

    return {
      id: "c-" + item.public_id,
      name: fileName + "." + item.format,
      caption: (context && context.caption) || niceName(fileName),
      fav: !!favs["c-" + item.public_id],
      added: Date.parse(item.created_at) || Date.now(),
      thumb: base + "f_auto,q_auto,w_700/" + path,
      src: base + "f_auto,q_auto,w_2000/" + path,
      download: base + "fl_attachment/" + path,
      shared: true
    };
  }

  function loadCloud() {
    if (!cloudOn()) {
      return Promise.resolve();
    }

    var url = "https://res.cloudinary.com/" + CONFIG.cloudName + "/image/list/" + CONFIG.tag + ".json";

    return fetch(url)
      .then(function (response) {
        // 404 just means nobody has uploaded a photo yet
        if (response.status === 404) {
          return { resources: [] };
        }
        if (!response.ok) {
          throw new Error("Cloudinary list unavailable");
        }
        return response.json();
      })
      .then(function (data) {
        cloud = (data.resources || []).map(cloudPhoto);
      })
      .catch(function () {
        cloud = [];
        showToast("Could not load the shared photos");
      });
  }

  async function uploadToCloud(file) {
    var blob = await shrinkImage(file);
    var form = new FormData();

    form.append("file", blob, file.name);
    form.append("upload_preset", CONFIG.uploadPreset);
    form.append("tags", CONFIG.tag);
    form.append("context", "caption=" + niceName(file.name).replace(/[=|]/g, " "));

    var response = await fetch(
      "https://api.cloudinary.com/v1_1/" + CONFIG.cloudName + "/image/upload",
      { method: "POST", body: form }
    );

    if (!response.ok) {
      throw new Error("Upload failed");
    }

    var data = await response.json();

    return cloudPhoto({
      public_id: data.public_id,
      version: data.version,
      format: data.format,
      created_at: data.created_at
    });
  }


  /* ---------- Uploading --------------------------------------------------- */

  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      var tempUrl = URL.createObjectURL(file);

      image.onload = function () {
        var scale = Math.min(1, MAX_SIZE / Math.max(image.width, image.height));
        var canvas = document.createElement("canvas");

        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

        URL.revokeObjectURL(tempUrl);

        canvas.toBlob(function (blob) {
          resolve(blob || file);
        }, "image/jpeg", JPEG_QUALITY);
      };

      image.onerror = function () {
        URL.revokeObjectURL(tempUrl);
        reject(new Error("Could not read image"));
      };

      image.src = tempUrl;
    });
  }

  async function addFiles(fileList) {
    var files = Array.prototype.filter.call(fileList, function (file) {
      return /^image\//.test(file.type);
    });
    var added = 0;
    var failed = 0;

    if (!files.length) {
      showToast("Please choose image files");
      return;
    }

    for (var i = 0; i < files.length; i++) {
      try {
        if (cloudOn()) {
          // Shared upload: everyone will see this photo
          showToast("Uploading " + (i + 1) + " of " + files.length + "…");
          cloud.push(await uploadToCloud(files[i]));
        } else {
          // Private upload: stays in this browser
          var blob = await shrinkImage(files[i]);
          var photo = {
            id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
            name: files[i].name,
            caption: files[i].name.replace(/\.[^.]+$/, ""),
            fav: false,
            added: Date.now() + i,
            blob: blob
          };

          photos.push(photo);
          dbPut(photo);
        }

        added++;
      } catch (error) {
        failed++;
      }
    }

    render();
    showToast(
      added + (added === 1 ? " photo added" : " photos added") +
      (failed ? ", " + failed + " failed" : "")
    );
  }

  function removePhoto(photo) {
    photos = photos.filter(function (item) {
      return item.id !== photo.id;
    });

    dbDelete(photo.id);

    if (urls[photo.id]) {
      URL.revokeObjectURL(urls[photo.id]);
      delete urls[photo.id];
    }
  }


  /* ---------- Rendering the grid ------------------------------------------ */

  function createCard(photo, position) {
    var card = document.createElement("div");
    var img = document.createElement("img");
    var caption = document.createElement("div");
    var heart = document.createElement("button");

    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", "Open " + photo.caption);

    img.src = photo.thumb || photoUrl(photo);
    img.alt = photo.caption;
    img.loading = "lazy";

    caption.className = "cap";
    caption.textContent = photo.caption;

    heart.className = "heart" + (photo.fav ? " on" : "");
    heart.textContent = photo.fav ? "♥" : "♡";
    heart.setAttribute("aria-label", photo.fav ? "Remove favorite" : "Add favorite");
    heart.onclick = function (event) {
      event.stopPropagation();
      toggleFav(photo);
    };

    card.append(img, caption, heart);

    if (!photo.shared) {
      var badge = document.createElement("span");

      badge.className = "badge";
      badge.textContent = "Only on this device";
      card.appendChild(badge);
    }

    card.onclick = function () {
      openViewer(position);
    };
    card.onkeydown = function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openViewer(position);
      }
    };

    return card;
  }

  function render() {
    var query = $("q").value.trim().toLowerCase();
    var grid = $("grid");
    var empty = $("empty");
    var total = allPhotos().length;
    var favCount = allPhotos().filter(function (photo) {
      return photo.fav;
    }).length;

    // Filter and sort
    view = allPhotos()
      .filter(function (photo) {
        var matchesFav = !favOnly || photo.fav;
        var matchesSearch = !query || photo.caption.toLowerCase().indexOf(query) > -1;
        return matchesFav && matchesSearch;
      })
      .sort(function (a, b) {
        return newestFirst ? b.added - a.added : a.added - b.added;
      });

    // Draw the cards
    grid.innerHTML = "";
    view.forEach(function (photo, position) {
      grid.appendChild(createCard(photo, position));
    });

    // Empty message and counters
    empty.hidden = view.length > 0;
    empty.textContent = total
      ? "Nothing matches. Try another search or filter."
      : "No photos to show yet. Upload your first one above.";

    $("stats").textContent =
      total + (total === 1 ? " photo" : " photos") +
      (favCount ? " · " + favCount + " favorite" + (favCount > 1 ? "s" : "") : "");
  }


  /* ---------- Full-screen viewer ------------------------------------------ */

  function openViewer(position) {
    index = position;
    $("lb").classList.add("open");
    document.body.style.overflow = "hidden";
    syncViewer();
    $("close").focus();
  }

  function closeViewer() {
    $("lb").classList.remove("open");
    document.body.style.overflow = "";
    zoomed = false;
  }

  function syncViewer() {
    var photo = view[index];
    var image = $("lbImg");

    if (!photo) {
      closeViewer();
      return;
    }

    image.src = photoUrl(photo);
    image.alt = photo.caption;
    image.style.transform = "";
    zoomed = false;

    $("capIn").value = photo.caption;
    $("capIn").readOnly = !!photo.shared;
    $("del").hidden = !!photo.shared;
    $("count").textContent = (index + 1) + " of " + view.length;
    $("favB").textContent = photo.fav ? "Unfavorite" : "Favorite";
    $("favB").classList.toggle("on", photo.fav);
  }

  function step(direction) {
    if (!view.length) {
      return;
    }

    index = (index + direction + view.length) % view.length;
    syncViewer();
  }

  function toggleZoom() {
    zoomed = !zoomed;
    $("lbImg").style.transform = zoomed ? "scale(2)" : "";
  }

  function downloadCurrent() {
    var photo = view[index];
    var link = document.createElement("a");

    link.href = photo.download || photoUrl(photo);
    link.download = photo.name.replace(/\.[^.]+$/, "") + ".jpg";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function deleteCurrent() {
    var photo = view[index];

    if (!photo || photo.shared || !confirm("Delete this photo?")) {
      return;
    }

    removePhoto(photo);
    render();

    if (!view.length) {
      closeViewer();
    } else {
      index = Math.min(index, view.length - 1);
      syncViewer();
    }

    showToast("Photo deleted");
  }

  function saveCaption() {
    var photo = view[index];

    if (!photo || photo.shared) {
      return;
    }

    photo.caption = $("capIn").value.trim() || photo.name;
    dbPut(photo);
    render();
    syncViewer();
    showToast("Caption saved");
  }


  /* ---------- Event listeners --------------------------------------------- */

  function bindViewerEvents() {
    $("prev").onclick = function () { step(-1); };
    $("next").onclick = function () { step(1); };
    $("close").onclick = closeViewer;
    $("zoom").onclick = toggleZoom;
    $("lbImg").onclick = toggleZoom;
    $("favB").onclick = function () { toggleFav(view[index]); };
    $("dl").onclick = downloadCurrent;
    $("del").onclick = deleteCurrent;
    $("capIn").onchange = saveCaption;

    // Click on the dark area around the photo closes the viewer
    $("lb").addEventListener("click", function (event) {
      if (event.target.classList.contains("stage")) {
        closeViewer();
      }
    });

    // Keyboard: arrows to move, Escape to close
    document.addEventListener("keydown", function (event) {
      if (!$("lb").classList.contains("open")) {
        return;
      }

      if (event.target.id === "capIn" && event.key !== "Escape") {
        return;
      }

      if (event.key === "Escape") { closeViewer(); }
      if (event.key === "ArrowLeft") { step(-1); }
      if (event.key === "ArrowRight") { step(1); }
    });

    // Touch: swipe left or right to change photo
    $("lb").addEventListener("touchstart", function (event) {
      touchStartX = event.touches[0].clientX;
    }, { passive: true });

    $("lb").addEventListener("touchend", function (event) {
      if (touchStartX === null || zoomed) {
        return;
      }

      var distance = event.changedTouches[0].clientX - touchStartX;

      touchStartX = null;

      if (Math.abs(distance) > 60) {
        step(distance > 0 ? -1 : 1);
      }
    });
  }

  function bindUploadEvents() {
    var fileInput = $("file");
    var dropZone = $("drop");

    function openPicker() {
      fileInput.click();
    }

    $("addBtn").onclick = openPicker;
    dropZone.onclick = openPicker;
    dropZone.onkeydown = function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPicker();
      }
    };

    fileInput.onchange = function () {
      addFiles(fileInput.files);
      fileInput.value = "";
    };

    // Drag and drop anywhere on the page
    ["dragenter", "dragover"].forEach(function (type) {
      document.addEventListener(type, function (event) {
        event.preventDefault();
        dropZone.classList.add("over");
      });
    });

    ["dragleave", "drop"].forEach(function (type) {
      document.addEventListener(type, function (event) {
        event.preventDefault();

        if (type === "drop" || event.relatedTarget === null) {
          dropZone.classList.remove("over");
        }
      });
    });

    document.addEventListener("drop", function (event) {
      if (event.dataTransfer && event.dataTransfer.files) {
        addFiles(event.dataTransfer.files);
      }
    });

    // Paste an image from the clipboard
    document.addEventListener("paste", function (event) {
      if (event.clipboardData && event.clipboardData.files.length) {
        addFiles(event.clipboardData.files);
      }
    });
  }

  function bindToolbarEvents() {
    $("q").oninput = render;

    $("favF").onclick = function () {
      favOnly = !favOnly;
      this.classList.toggle("on", favOnly);
      this.setAttribute("aria-pressed", favOnly);
      render();
    };

    $("sortB").onclick = function () {
      newestFirst = !newestFirst;
      this.textContent = newestFirst ? "Newest first" : "Oldest first";
      render();
    };

    $("clearB").onclick = function () {
      if (!photos.length) {
        showToast("You have no uploads to delete");
        return;
      }

      if (!confirm("Delete your " + photos.length + " uploaded photos from this device? This can’t be undone.")) {
        return;
      }

      Object.keys(urls).forEach(function (key) {
        URL.revokeObjectURL(urls[key]);
      });

      urls = {};
      photos = [];
      dbClear();
      render();
      showToast("Your uploads were deleted");
    };
  }


  /* ---------- Start ------------------------------------------------------- */

  bindViewerEvents();
  bindUploadEvents();
  bindToolbarEvents();
  loadFavs();

  openDB()
    .then(dbAll)
    .then(function (rows) {
      photos = rows;
      render();
      return Promise.all([loadShared(), loadCloud()]);
    })
    .then(render);

  // Adjust the wording when shared uploads are switched on
  if (cloudOn()) {
    $("drop").querySelector("span").textContent =
      "or click to choose files. Everything you upload is added to the gallery for all visitors.";
  }
})();
