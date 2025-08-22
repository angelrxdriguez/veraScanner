    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const btnStart = document.getElementById('btnStart');
    const btnCapture = document.getElementById('btnCapture');
    const btnStop = document.getElementById('btnStop');
    const fileInput = document.getElementById('fileInput');
    const ocrProgressWrap = document.getElementById('ocrProgressWrap');
    const ocrProgressBar = document.getElementById('ocrProgressBar');
    const textoDetectado = document.getElementById('textoDetectado');
    const ocrLoading = document.getElementById('ocrLoading');
    const ocrLoadPct = document.getElementById('ocrLoadPct');

    let stream = null;
    let worker = null;

    const showProgress = (p) => {
      ocrProgressWrap.classList.remove('d-none');
      const pct = Math.round((p || 0) * 100);
      ocrProgressBar.style.width = pct + '%';
      ocrProgressBar.textContent = pct + '%';
    };
    const hideProgress = () => {
      ocrProgressWrap.classList.add('d-none');
      ocrProgressBar.style.width = '0%';
      ocrProgressBar.textContent = '';
    };

    const norm = (s) => s
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\t\r]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    async function initOCR() {
      // Crea el worker y carga idiomas spa+eng
      worker = await Tesseract.createWorker({
        logger: (m) => {
          if (m.status && typeof m.progress === 'number') {
            if (ocrLoading && m.status.includes('loading')) {
              ocrLoadPct.textContent = Math.round(m.progress * 100) + '%';
            }
          }
        },
      });
      await worker.loadLanguage('spa+eng');
      await worker.initialize('spa+eng');
      if (ocrLoading) ocrLoading.remove();
    }

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Tu navegador no permite acceso a la cámara. Usa la opción "Subir foto".');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        video.srcObject = stream;
        await video.play();
        btnCapture.disabled = false;
        btnStop.disabled = true; // lo habilitamos tras play estable
        // A veces el video tarda en estar listo
        video.onloadedmetadata = () => { btnStop.disabled = false; };
      } catch (err) {
        console.error(err);
        alert('No se pudo acceder a la cámara. Revisa permisos y HTTPS.');
      }
    }

    function stopCamera() {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      video.srcObject = null;
      btnCapture.disabled = true;
      btnStop.disabled = true;
    }

    function captureBlobFromVideo() {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
      });
    }

    async function doOCRFromBlob(blob) {
      if (!worker) {
        alert('OCR aún no cargado. Espera un momento.');
        return;
      }
      showProgress(0);
      const { data: { text } } = await worker.recognize(blob, {
        // El logger de recognize se maneja a nivel worker global (arriba)
      });
      hideProgress();
      const limpio = norm(text);
      textoDetectado.textContent = limpio || '(sin texto)';
      const modal = new bootstrap.Modal(document.getElementById('resultadoModal'));
      modal.show();
    }

    // Eventos
    btnStart.addEventListener('click', startCamera);
    btnStop.addEventListener('click', stopCamera);
    btnCapture.addEventListener('click', async () => {
      try {
        const blob = await captureBlobFromVideo();
        await doOCRFromBlob(blob);
      } catch (e) {
        console.error(e);
        alert('No se pudo capturar/leer la imagen.');
      }
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await doOCRFromBlob(file);
      fileInput.value = '';
    });

    document.getElementById('btnCopiar').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textoDetectado.textContent || '');
        const btn = document.getElementById('btnCopiar');
        const original = btn.textContent;
        btn.textContent = '¡Copiado!';
        setTimeout(()=> btn.textContent = original, 1200);
      } catch (e) { alert('No se pudo copiar al portapapeles.'); }
    });

    // Inicializa OCR al cargar la página
    (async () => { await initOCR(); })();