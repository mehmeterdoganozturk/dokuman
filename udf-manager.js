/* ===== UDF Multi-Document Manager ===== */
/* Bağımsız modül — app.js init()'ten sonra çağrılır */

(function () {
  'use strict';

  // ===== Tarayıcı Yetenekleri =====
  //
  // Chrome/Edge 86+  : showOpenFilePicker ✅  createWritable ✅  → Dosyayı YERINDE yazar
  // Firefox 111+     : showOpenFilePicker ✅  createWritable ❌  → showSaveFilePicker ile kayıt diyaloğu
  // Zen (FF tabanlı) : Aynı Firefox gibi
  // Diğerleri        : Her ikisi de yok    → normal indirme

  const IS_SECURE = window.isSecureContext;

  // Dosya açma desteği (okuma)
  const FSA_OPEN = IS_SECURE && typeof window.showOpenFilePicker === 'function';

  // Dosyayı geri yazma desteği (Chrome/Edge)
  const FSA_WRITE = FSA_OPEN &&
    typeof FileSystemFileHandle !== 'undefined' &&
    typeof FileSystemFileHandle.prototype.createWritable === 'function';

  // "Farklı Kaydet" diyaloğu (Firefox/Zen)
  const FSA_SAVE_DIALOG = IS_SECURE && typeof window.showSaveFilePicker === 'function';

  // Bilgi notu
  const noticeEl   = document.getElementById('udfApiNotice');
  const noticeText = document.getElementById('udfApiNoticeText');
  if (noticeEl && noticeText) {
    if (FSA_WRITE) {
      noticeText.textContent = '✅ Chrome/Edge: Kaydet butonu dosyayı orijinal konumuna yazar.';
    } else if (FSA_SAVE_DIALOG) {
      noticeText.textContent = '💾 Firefox/Zen: Kaydet butonu "Farklı Kaydet" diyaloğu açar — orijinal dosyanın bulunduğu klasöre gidin ve üzerine kaydedin.';
    } else if (!IS_SECURE) {
      const port = window.location.port || '8090';
      noticeText.textContent =
        '⚠️ Doğrudan kaydetmek için http://127.0.0.1:' + port +
        ' adresini kullanın. Mevcut adres (' + window.location.hostname + ') güvenli bağlam değil.';
    } else {
      noticeText.textContent = '⬇ Bu tarayıcı doğrudan kaydetmeyi desteklemiyor. Kaydet = indirme.';
    }
    noticeEl.style.display = 'flex';
  }


  // ===== State =====
  const udfFiles = [];  // { id, name, html, headerHtml, footerHtml, contentXml, fileHandle, signature, signerName, dirty }
  let activeId = null;
  let nextId   = 1;

  // ===== DOM Refs =====
  const udfPanel       = document.getElementById('udfPanel');
  const udfPanelClose  = document.getElementById('udfPanelClose');
  const btnTogglePanel = document.getElementById('btnTogglePanel');
  const udfAddBtn      = document.getElementById('udfAddBtn');
  const udfMultiInput  = document.getElementById('udfMultiInput'); // Firefox fallback
  const udfFileList    = document.getElementById('udfFileList');
  const udfEmptyState  = document.getElementById('udfEmptyState');
  const udfSaveBtn     = document.getElementById('udfSaveActiveBtn');
  const udfSignBtn     = document.getElementById('udfSignActiveBtn');

  // ===== Panel toggle =====
  function togglePanel(open) {
    const isCollapsed = udfPanel.classList.contains('collapsed');
    const shouldCollapse = open !== undefined ? !open : !isCollapsed;
    udfPanel.classList.toggle('collapsed', shouldCollapse);
  }
  btnTogglePanel && btnTogglePanel.addEventListener('click', () => togglePanel());
  udfPanelClose  && udfPanelClose.addEventListener('click',  () => togglePanel(false));

  // ===== "UDF Dosyası Ekle" butonu =====
  udfAddBtn && udfAddBtn.addEventListener('click', () => {
    if (FSA_OPEN) {
      openWithFilePicker();
    } else {
      // Güvensiz bağlam veya desteksiz tarayıcı: klasik input
      udfMultiInput && udfMultiInput.click();
    }
  });

  // Fallback: <input type=file> değiştiğinde (Firefox)
  udfMultiInput && udfMultiInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      await loadUdfFromFile(f, null); // fileHandle yok → kaydet = indir
    }
    udfMultiInput.value = '';
  });

  // ===== showOpenFilePicker ile aç (Chrome/Edge) =====
  async function openWithFilePicker() {
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{
          description: 'UDF Dosyaları',
          accept: { 'application/octet-stream': ['.udf'] }
        }]
      });
    } catch (err) {
      if (err.name === 'AbortError') return; // Kullanıcı iptal etti
      // Picker desteklenmiyorsa input'a düş
      udfMultiInput && udfMultiInput.click();
      return;
    }

    for (const handle of handles) {
      // Zaten listede var mı?
      const already = udfFiles.find(f => f.fileHandle &&
        (f.fileHandle.name === handle.name));
      if (already) {
        showAppToast(handle.name + ' zaten listede', 'info');
        continue;
      }
      const file = await handle.getFile();
      await loadUdfFromFile(file, handle); // fileHandle → üzerine yazılabilir
    }
  }

  // ===== UDF dosyasını yükle =====
  async function loadUdfFromFile(file, fileHandle) {
    try {
      const arrayBuf   = await file.arrayBuffer();
      const zip        = await JSZip.loadAsync(arrayBuf);
      const contentFile = zip.file('content.xml');
      if (!contentFile) {
        showAppToast('content.xml bulunamadı: ' + file.name, 'error');
        return;
      }
      const contentXml = await contentFile.async('string');
      
      // Extract sicil for watermark & validation code for barcode
      const propsFile = zip.file('documentproperties.xml');
      let sicil = '';
      let validationCode = '';
      if (propsFile) {
          const propsXml = await propsFile.async('string');
          const parser = new DOMParser();
          const propsDoc = parser.parseFromString(propsXml, 'text/xml');
          
          const sicilEntry = propsDoc.querySelector('entry[key="uyapsicil"]');
          if (sicilEntry) sicil = sicilEntry.textContent;
          
          const codeEntry = propsDoc.querySelector('entry[key="uyapdogrulamakodu"]');
          if (codeEntry) validationCode = codeEntry.textContent;
      }
      
      if (sicil) {
          const watermarkText = (sicil + ' ').repeat(10);
          const fullWatermark = (watermarkText + '\n').repeat(15);
          document.documentElement.style.setProperty('--watermark-text', `"${fullWatermark}"`);
      } else {
          document.documentElement.style.setProperty('--watermark-text', '""');
      }

      const parsed = window.parseUdfXmlPublic
        ? window.parseUdfXmlPublic(contentXml, validationCode)
        : { body: '<p>' + file.name + '</p>', header: '', footer: '' };

      const html = parsed.body;
      const headerHtml = parsed.header || '';
      const footerHtml = parsed.footer || '';
      const hasHeader = parsed.hasHeader;
      const hasFooter = parsed.hasFooter;

      // Mevcut imza var mı?
      const sgnFile = zip.file('sign.sgn');
      let sigB64 = null;
      let signerNameFromSgn = null;
      let certDetailsFromSgn = null;

      const extractCertInfoFromP7 = (bytes) => {
        try {
          const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
          
          const extractOidValues = (oid) => {
            let lastPos = 0;
            const values = [];
            while (true) {
              const idx = hex.indexOf(oid, lastPos);
              if (idx === -1) break;
              let start = idx + oid.length;
              const tag = hex.substring(start, start + 2);
              let len = parseInt(hex.substring(start + 2, start + 4), 16);
              let offset = 4;
              if (len > 128) {
                const lenBytes = len - 128;
                len = parseInt(hex.substring(start + 4, start + 4 + (lenBytes * 2)), 16);
                offset = 4 + (lenBytes * 2);
              }
              const contentHex = hex.substring(start + offset, start + offset + (len * 2));
              let val = '';
              if (tag === '1e') {
                for (let i = 0; i < contentHex.length; i += 4) {
                  val += String.fromCharCode(parseInt(contentHex.substring(i, i + 4), 16));
                }
              } else {
                for (let i = 0; i < contentHex.length; i += 2) {
                  val += String.fromCharCode(parseInt(contentHex.substring(i, i + 2), 16));
                }
                try { val = decodeURIComponent(escape(val)); } catch(e) {}
              }
              if (val.trim()) values.push(val.trim());
              lastPos = start + offset + (len * 2);
            }
            return values;
          };

          const cns = extractOidValues('0603550403');
          const sns = extractOidValues('0603550405'); // SerialNumber OID
          
          const filterKeywords = ['SAĞLAYICI', 'MAKAM', 'HİZMET', 'SERTİFİKA', 'KÖK', 'ROOT', 'BİLİŞİM', 'TÜBİTAK', 'EYP', 'CA ', 'TRUST'];
          const filteredCns = cns.filter(n => !filterKeywords.some(k => n.toUpperCase().includes(k)));
          const personName = filteredCns.find(n => n.includes('(') || (/\d{11}/.test(n))) || filteredCns[0] || cns[0];
          
          // TCKN Maskeleme: 15*******48
          let tckn = sns.find(s => /\d{11}/.test(s)) || cns.find(c => /\d{11}/.test(c)) || '';
          const tcknMatch = tckn.match(/\d{11}/);
          let maskedTckn = '';
          if (tcknMatch) {
            const t = tcknMatch[0];
            maskedTckn = t.substring(0, 2) + "*******" + t.substring(9);
          }

          // Seri No (Certificate Serial Number)
          // v3 TBSCertificate başlangıcı: [A0 03 02 01 02] (Version v3) + [02] (Integer Tag)
          let certSerial = '';
          const v3Pattern = 'a00302010202';
          const vIdx = hex.indexOf(v3Pattern);
          if (vIdx !== -1) {
            const lenStart = vIdx + v3Pattern.length;
            let len = parseInt(hex.substring(lenStart, lenStart + 2), 16);
            let offset = 2;
            if (len > 128) {
                const lb = len - 128;
                len = parseInt(hex.substring(lenStart + 2, lenStart + 2 + (lb * 2)), 16);
                offset = 2 + (lb * 2);
            }
            const serialHex = hex.substring(lenStart + offset, lenStart + offset + (len * 2));
            if (serialHex) {
              try {
                certSerial = BigInt("0x" + serialHex).toString();
              } catch(e) {
                certSerial = serialHex.toUpperCase().match(/.{1,2}/g).join(':');
              }
            }
          }

          if (!certSerial) {
            certSerial = sns.find(s => !/\d{11}/.test(s)) || 'Ayrıştırılamadı (Bridge Kapalı)';
          }

          // Tarih çıkarma (UTCTime 17 veya GeneralizedTime 18)
          const extractDate = (startIdx) => {
             const tag = hex.substring(startIdx, startIdx + 2);
             const len = parseInt(hex.substring(startIdx + 2, startIdx + 4), 16);
             const content = hex.substring(startIdx + 4, startIdx + 4 + (len * 2));
             let str = '';
             for (let i = 0; i < content.length; i += 2) str += String.fromCharCode(parseInt(content.substring(i, i + 2), 16));
             
             let year, month, day, hour, min, sec;
             if (tag === '17') {
                 year = parseInt(str.substring(0, 2));
                 year += (year < 50 ? 2000 : 1900);
                 month = str.substring(2, 4); day = str.substring(4, 6);
                 hour = str.substring(6, 8); min = str.substring(8, 10); sec = str.substring(10, 12);
             } else {
                 year = str.substring(0, 4); month = str.substring(4, 6); day = str.substring(6, 8);
                 hour = str.substring(8, 10); min = str.substring(10, 12); sec = str.substring(12, 14);
             }
             return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
          };

          let validFrom = null, validTo = null;
          const timeIdx = hex.indexOf('170d');
          if (timeIdx !== -1) {
              validFrom = extractDate(timeIdx);
              const nextIdx = hex.indexOf('170d', timeIdx + 10);
              if (nextIdx !== -1) validTo = extractDate(nextIdx);
          }

          return {
            signerName: personName || 'E-İmza Sahibi',
            certDetails: {
                subject: personName,
                issuer: cns.find(n => filterKeywords.some(k => n.toUpperCase().includes(k))) || 'E-İmza Hizmet Sağlayıcısı',
                serial: certSerial,
                identityNo: maskedTckn,
                validFrom: validFrom,
                validTo: validTo
            }
          };
        } catch (e) { console.error('P7 parse error:', e); }
        return { signerName: 'E-İmzalı Doküman', certDetails: null };
      };

      if (sgnFile) {
        const sigBytes = await sgnFile.async('uint8array');
        sigB64 = uint8ToBase64(sigBytes);
        
        const localParsed = extractCertInfoFromP7(sigBytes);
        signerNameFromSgn = localParsed.signerName;
        certDetailsFromSgn = localParsed.certDetails;

        try {
          const res = await fetch('http://127.0.0.1:5005/parse_signature', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signature: sigB64 })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success) {
              signerNameFromSgn = data.signerName;
              certDetailsFromSgn = data.certDetails;
            }
          }
        } catch (e) {}
      }

      const id = nextId++;
      udfFiles.push({
        id,
        name: file.name,
        html,
        headerHtml,
        footerHtml,
        hasHeader,
        hasFooter,
        contentXml,
        fileHandle: fileHandle || null,   // null ise kaydet = indir
        signature:  sigB64,
        signerName: signerNameFromSgn,
        certDetails: certDetailsFromSgn,
        dirty: false
      });

      renderFileList();
      switchTo(id);
      const loc = fileHandle ? '(orijinal konum bağlandı)' : '(indirme olarak kaydedilir)';
      showAppToast(file.name + ' eklendi ' + loc, 'success');
    } catch (err) {
      showAppToast('Dosya okunamadı: ' + err.message, 'error');
      console.error('[UDF Manager] loadUdfFromFile hatası:', err);
    }
  }

  // ===== Yardımcılar =====
  function uint8ToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function base64ToUint8Array(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ===== Aktif dosyayı değiştir =====
  function switchTo(id) {
    // Mevcut dosyanın editör içeriğini kaydet
    if (activeId !== null) {
      const cur = udfFiles.find(f => f.id === activeId);
      if (cur) {
        if (window.PaginationManager) {
          cur.html = window.PaginationManager.getAllContentHTML();
          cur.headerHtml = window.PaginationManager.getGlobalHeaderHTML();
          cur.footerHtml = window.PaginationManager.getGlobalFooterHTML();
        } else {
          const editorEl = document.getElementById('editor');
          if (editorEl) cur.html = editorEl.innerHTML;
          const headerEl = document.getElementById('headerArea');
          if (headerEl) cur.headerHtml = headerEl.innerHTML;
          const footerEl = document.getElementById('footerArea');
          if (footerEl) cur.footerHtml = footerEl.innerHTML;
        }
      }
    }

    activeId = id;
    const file = udfFiles.find(f => f.id === id);
    if (!file) return;

    const visualStamp = document.getElementById('visualSignatureStamp');
    if (visualStamp) {
      const templates = document.getElementById('hidden-templates');
      if (templates) templates.appendChild(visualStamp);
    }

    if (window.PaginationManager) {
      window.PaginationManager.loadAllContent(file.html, file.headerHtml, file.footerHtml);
    } else {
      const editorEl = document.getElementById('editor');
      if (editorEl) editorEl.innerHTML = file.html;
      const headerEl = document.getElementById('headerArea');
      if (headerEl) {
        headerEl.innerHTML = file.headerHtml || '';
        headerEl.style.display = file.hasHeader ? 'block' : 'none';
      }
      const footerEl = document.getElementById('footerArea');
      if (footerEl) {
        footerEl.innerHTML = file.footerHtml || '';
        footerEl.style.display = file.hasFooter ? 'block' : 'none';
      }
    }

    const titleEl = document.getElementById('documentTitle');
    if (titleEl) titleEl.value = file.name.replace(/\.udf$/i, '');

    if (window.setSignatureStatePublic) {
      window.setSignatureStatePublic(file.signature, file.signerName, file.certDetails);
    } else if (window.updateSignedStatusPublic) {
      window.updateSignedStatusPublic(!!file.signature);
    }
    if (window.updateCountsPublic)       window.updateCountsPublic();

    udfSaveBtn && (udfSaveBtn.disabled = false);
    udfSignBtn && (udfSignBtn.disabled = false);

    // Kaydet butonunu fileHandle durumuna göre güncelle
    updateSaveBtnLabel(file);
    renderFileList();
  }

  window.udfManagerUpdateHeaderFooter = (hasHeader, hasFooter) => {
    if (activeId === null) return;
    const file = udfFiles.find(f => f.id === activeId);
    if (!file) return;
    if (hasHeader !== null) file.hasHeader = hasHeader;
    if (hasFooter !== null) file.hasFooter = hasFooter;
  };

  function updateSaveBtnLabel(file) {
    if (!udfSaveBtn) return;
    const span = udfSaveBtn.querySelector('span:last-child');
    if (!span) return;
    if (file && file.fileHandle && FSA_WRITE) {
      span.textContent = '💾 Kaydet (orijinal üzerine)';
    } else if (FSA_SAVE_DIALOG) {
      span.textContent = '💾 Kaydet (farklı kaydet diyaloğu)';
    } else if (!IS_SECURE) {
      const port = window.location.port || '8090';
      span.textContent = '⚠ http://127.0.0.1:' + port + ' adresiyle açın';
    } else {
      span.textContent = '⬇ Kaydet (indir)';
    }
  }

  // ===== Dosya listesini çiz =====
  function renderFileList() {
    if (!udfFileList) return;
    udfFileList.innerHTML = '';

    if (udfFiles.length === 0) {
      udfEmptyState && udfFileList.appendChild(udfEmptyState);
      if (udfEmptyState) udfEmptyState.style.display = 'flex';
      udfSaveBtn && (udfSaveBtn.disabled = true);
      udfSignBtn && (udfSignBtn.disabled = true);
      return;
    }

    udfFiles.forEach(f => {
      const item = document.createElement('div');
      item.className = 'udf-file-item' +
        (f.id === activeId ? ' active' : '') +
        (f.signature ? ' signed' : '');

      const icon = document.createElement('span');
      icon.className = 'material-icons-outlined udf-file-icon';
      icon.textContent = f.signature ? 'verified' : 'description';

      const info = document.createElement('div');
      info.className = 'udf-file-info';

      const name = document.createElement('div');
      name.className = 'udf-file-name';
      name.textContent = f.name;
      name.title = f.fileHandle
        ? '✓ Orijinal konuma kaydedilebilir\n' + f.name
        : '⚠ Tarayıcı kayıt izni yok — indirme olarak çalışır\n' + f.name;

      const meta = document.createElement('div');
      meta.className = 'udf-file-meta';

      if (f.signature) {
        const b = document.createElement('span');
        b.className = 'udf-badge udf-badge-signed';
        b.textContent = f.signerName ? 'İmzalı: ' + f.signerName : 'İmzalı';
        b.title = f.signerName ? 'İmzalayan: ' + f.signerName : 'İmzalı Doküman';
        meta.appendChild(b);
      }
      if (f.dirty) {
        const b = document.createElement('span');
        b.className = 'udf-badge udf-badge-dirty';
        b.textContent = 'Değişti';
        meta.appendChild(b);
      }
      // Kayıt modu göstergesi
      const modeBadge = document.createElement('span');
      modeBadge.className = 'udf-badge';
      if (f.fileHandle) {
        modeBadge.className += ' udf-badge-writable';
        modeBadge.textContent = '💾 Yazılabilir';
        modeBadge.title = 'Dosya orijinal konumuna kaydedilecek';
      } else {
        modeBadge.className += ' udf-badge-download';
        modeBadge.textContent = '⬇ İndirilir';
        modeBadge.title = 'Chrome/Edge kullanınız';
      }
      meta.appendChild(modeBadge);

      info.appendChild(name);
      info.appendChild(meta);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'udf-file-remove';
      removeBtn.title = 'Listeden Kaldır';
      removeBtn.innerHTML = '<span class="material-icons-outlined">close</span>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(f.id);
      });

      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(removeBtn);
      item.addEventListener('click', () => switchTo(f.id));
      udfFileList.appendChild(item);
    });
  }

  // ===== Dosyayı listeden kaldır =====
  function removeFile(id) {
    const idx = udfFiles.findIndex(f => f.id === id);
    if (idx === -1) return;
    if (udfFiles[idx].dirty) {
      if (!confirm(udfFiles[idx].name + ' dosyasında kaydedilmemiş değişiklikler var. Yine de kaldırılsın mı?')) return;
    }
    udfFiles.splice(idx, 1);
    if (activeId === id) {
      activeId = null;
      if (window.PaginationManager) {
        window.PaginationManager.loadAllContent('', '', '');
      } else {
        const editorEl = document.getElementById('editor');
        if (editorEl) editorEl.innerHTML = '';
        const headerEl = document.getElementById('headerArea');
        if (headerEl) headerEl.innerHTML = '';
        const footerEl = document.getElementById('footerArea');
        if (footerEl) footerEl.innerHTML = '';
      }
      if (window.updateSignedStatusPublic) window.updateSignedStatusPublic(false);
      if (udfFiles.length > 0) switchTo(udfFiles[Math.max(0, idx - 1)].id);
    }
    renderFileList();
  }

  // ===== UDF blobu oluştur =====
  async function buildUdfBlob(file) {
    // Aktif dosyaysa editörden güncel HTML al
    if (file.id === activeId) {
      if (window.PaginationManager) {
        file.html = window.PaginationManager.getAllContentHTML();
        file.headerHtml = window.PaginationManager.getGlobalHeaderHTML();
        file.footerHtml = window.PaginationManager.getGlobalFooterHTML();
      } else {
        const editorEl = document.getElementById('editor');
        if (editorEl) file.html = editorEl.innerHTML;
        const headerEl = document.getElementById('headerArea');
        if (headerEl) file.headerHtml = headerEl.innerHTML;
        const footerEl = document.getElementById('footerArea');
        if (footerEl) file.footerHtml = footerEl.innerHTML;
      }
    }

    let contentXml;

    if (file.signature && !file.dirty) {
      // ✅ Dosya imzalı VE bu oturumda değiştirilmedi:
      //    İmzalama anındaki orijinal XML'i kullan — UYAP hash doğrulaması geçer
      contentXml = file.contentXml;

    } else if (file.dirty) {
      // ✅ Dosya değiştirildi (imzalı olsa bile):
      //    Editörden güncel XML üret
      contentXml = window.generateUdfXmlPublic
        ? window.generateUdfXmlPublic(null, null)  // imzasız üret
        : (file.contentXml || '');
      file.contentXml = contentXml;

      // İmzalı bir dosyayı düzenlediyse eski imzayı sil
      // (içerik değişti → eski imza artık geçersiz)
      if (file.signature) {
        file.signature  = null;
        file.signerName = null;
        if (window.updateSignedStatusPublic) window.updateSignedStatusPublic(false);
        showAppToast('⚠️ İçerik değiştiği için eski imza kaldırıldı. Tekrar imzalayın.', 'info');
      }

    } else {
      // İmzasız, değiştirilmemiş — editörden üret
      contentXml = window.generateUdfXmlPublic
        ? window.generateUdfXmlPublic(null, null)
        : (file.contentXml || '');
      file.contentXml = contentXml;
    }

    const zip = new JSZip();
    zip.file('content.xml', contentXml);
    if (file.signature) {
      zip.file('sign.sgn', base64ToUint8Array(file.signature));
    }
    // Mobil tarayıcı düzeltmesi: octet-stream ile .zip→.udf yeniden adlandırması engellenir
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    return new Blob([bytes], { type: 'application/octet-stream' });
  }

  // ===== Aktif dosyayı kaydet =====
  udfSaveBtn && udfSaveBtn.addEventListener('click', () => saveActive());

  async function saveActive() {
    const file = udfFiles.find(f => f.id === activeId);
    if (!file) { showAppToast('Aktif dosya yok', 'info'); return; }

    const blob = await buildUdfBlob(file);

    if (file.fileHandle && FSA_WRITE) {
      // ========================================================
      // A) Chrome/Edge: createWritable() → doğrudan üzerine yaz
      // ========================================================
      try {
        const perm = await file.fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          const req = await file.fileHandle.requestPermission({ mode: 'readwrite' });
          if (req !== 'granted') {
            showAppToast('Yazma izni verilmedi — diyalog açılıyor...', 'error');
            await saveWithDialog(blob, file);
            return;
          }
        }
        const writable = await file.fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        file.dirty = false;
        renderFileList();
        showAppToast('✅ ' + file.name + ' orijinal konumuna kaydedildi.', 'success');
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[UDF Manager] createWritable hatası:', err);
        // createWritable başarısız → showSaveFilePicker'a düş
        await saveWithDialog(blob, file);
      }

    } else if (FSA_SAVE_DIALOG) {
      // ========================================================
      // B) Firefox/Zen: showSaveFilePicker → "Farklı Kaydet" diyaloğu
      //    Kullanıcı orijinal dosyanın bulunduğu klasöre gidip üzerine kaydeder
      // ========================================================
      await saveWithDialog(blob, file);

    } else {
      // ========================================================
      // C) Desteksiz / güvensiz bağlam: normal indirme
      // ========================================================
      triggerDownload(blob, file.name);
      file.dirty = false;
      renderFileList();
      showAppToast(file.name + ' indirildi.', 'info');
    }
  }

  // showSaveFilePicker ile kaydet (Firefox/Zen ve Chrome fallback)
  async function saveWithDialog(blob, file) {
    if (typeof window.showSaveFilePicker !== 'function') {
      // Hiç destek yok → indir
      triggerDownload(blob, file.name);
      file.dirty = false;
      renderFileList();
      showAppToast(file.name + ' indirildi.', 'info');
      return;
    }
    try {
      const saveHandle = await window.showSaveFilePicker({
        suggestedName: file.name,
        types: [{
          description: 'UDF Dosyası',
          accept: { 'application/octet-stream': ['.udf'] }
        }]
      });
      const writable = await saveHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      // Yeni konumu fileHandle olarak sakla (bir sonraki kayıtta doğrudan yazar)
      file.fileHandle = saveHandle;
      file.name      = saveHandle.name;
      file.dirty     = false;
      renderFileList();
      updateSaveBtnLabel(file);
      showAppToast('✅ ' + file.name + ' kaydedildi.', 'success');
    } catch (err) {
      if (err.name === 'AbortError') return; // Kullanıcı iptal etti
      console.error('[UDF Manager] showSaveFilePicker hatası:', err);
      // Hiçbiri çalışmadı → indir
      triggerDownload(blob, file.name);
      file.dirty = false;
      renderFileList();
      showAppToast(file.name + ' indirildi (diyalog başarısız).', 'info');
    }
  }


  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ===== İmzalama butonu =====
  udfSignBtn && udfSignBtn.addEventListener('click', () => {
    const signBtn = document.getElementById('actionSignUDF');
    if (signBtn) signBtn.click();
  });

  // ===== Dirty işaretleme (app.js'den çağrılır) =====
  window.udfManagerMarkDirty = function () {
    const file = udfFiles.find(f => f.id === activeId);
    if (file) { file.dirty = true; renderFileList(); }
  };

  // ===== İmzalama tamamlandığında (app.js'den çağrılır) =====
  window.udfManagerOnSigned = async function (signedMime, signerName, contentXml) {
    const file = udfFiles.find(f => f.id === activeId);
    if (file) {
      file.signature  = signedMime;
      file.signerName = signerName;
      file.contentXml = contentXml;
      file.dirty = false;
    }
    await saveActive();
  };

  // ===== Toast yardımcısı =====
  function showAppToast(msg, type) {
    if (window.showToastPublic) { window.showToastPublic(msg, type); return; }
    console.log('[UDF Manager]', type?.toUpperCase(), msg);
  }

  // ===== CSS — ek badge renkleri (runtime injection) =====
  const styleTag = document.createElement('style');
  styleTag.textContent = `
    .udf-badge-writable  { background: #10b981; color: #fff; }
    .udf-badge-download  { background: #94a3b8; color: #fff; }
  `;
  document.head.appendChild(styleTag);

  // ===== Global API — app.js'den çağrılır =====

  // Yeni boş belge panele ekler (seçili olanın üzerine YAZMAZ)
  window.udfManagerAddNew = function () {
    const editorEl = document.getElementById('editor');
    const titleEl  = document.getElementById('documentTitle');

    // Mevcut aktif dosyanın içeriğini kaydet
    if (activeId !== null) {
      const cur = udfFiles.find(f => f.id === activeId);
      if (cur) {
        if (window.PaginationManager) {
          cur.html = window.PaginationManager.getAllContentHTML();
          cur.headerHtml = window.PaginationManager.getGlobalHeaderHTML();
          cur.footerHtml = window.PaginationManager.getGlobalFooterHTML();
        } else {
          const editorEl = document.getElementById('editor');
          if (editorEl) cur.html = editorEl.innerHTML;
        }
      }
    }

    const id   = nextId++;
    const name = 'Adsız-' + id + '.udf';
    udfFiles.push({
      id,
      name,
      html: '<p><br></p>',
      headerHtml: '',
      footerHtml: '',
      hasHeader: false,
      hasFooter: false,
      contentXml: '',
      fileHandle: null,
      signature: null,
      signerName: null,
      dirty: false
    });

    renderFileList();
    switchTo(id);
    if (window.updateSignedStatusPublic) window.updateSignedStatusPublic(false);
    showAppToast('Yeni belge panele eklendi: ' + name, 'success');
    // Paneli aç
    togglePanel(true);
  };

  // URL'den parametrelerle şablon indirip panele ekler (GET Entegrasyonu)
  window.udfManagerLoadFromUrl = async function (templateUrl, params) {
    try {
      showAppToast('Şablon yükleniyor...', 'info');
      const response = await fetch(templateUrl);
      if (!response.ok) throw new Error("Şablon bulunamadı (HTTP " + response.status + ")");
      const arrayBuf = await response.arrayBuffer();

      // ZIP'i sadece ismini alıp içeriğini değiştirmeden File nesnesine çevirelim
      const parts = templateUrl.split('/');
      let baseName = parts[parts.length - 1] || 'sablon.udf';
      baseName = baseName.replace(/\.udf$/i, '');
      const fileName = baseName + '_doldurulmus.udf';

      const fileObj = new File([arrayBuf], fileName, { type: 'application/octet-stream' });

      // UDF'yi normal şekilde yükle (bu işlem orijinal XML'i doğru şekilde HTML'e çevirir)
      await loadUdfFromFile(fileObj, null);
      
      // Yükleme sonrası HTML üzerinden replace yapalım ki XML offsetleri bozulmasın!
      if (udfFiles.length > 0) {
        const fileEntry = udfFiles[udfFiles.length - 1];
        
        for (const [key, value] of Object.entries(params)) {
          const safeKey = key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
          const regex = new RegExp(`\\[${safeKey}\\]`, 'g');
          if (fileEntry.html) fileEntry.html = fileEntry.html.replace(regex, value);
          if (fileEntry.headerHtml) fileEntry.headerHtml = fileEntry.headerHtml.replace(regex, value);
          if (fileEntry.footerHtml) fileEntry.footerHtml = fileEntry.footerHtml.replace(regex, value);
        }
        
        fileEntry.dirty = true;
        
        // Aktif dosya bu ise DOM'u güncelle
        if (activeId === fileEntry.id) {
          const editorEls = document.querySelectorAll('.editor');
          if (editorEls.length > 0 && window.PaginationManager) {
             // HTML'i loadAllContent ile yeniden yükle (A4 sayfalamayı otomatik yapsın)
             window.PaginationManager.loadAllContent(fileEntry.html, fileEntry.headerHtml, fileEntry.footerHtml);
          } else {
             const editorEl = document.getElementById('editor');
             if (editorEl) editorEl.innerHTML = fileEntry.html;
             const headerEl = document.getElementById('headerArea');
             if (headerEl) headerEl.innerHTML = fileEntry.headerHtml || '';
             const footerEl = document.getElementById('footerArea');
             if (footerEl) footerEl.innerHTML = fileEntry.footerHtml || '';
          }
        }
        
        renderFileList();
      }

      togglePanel(true);
      showAppToast('Şablon başarıyla dolduruldu.', 'success');
    } catch (err) {
      console.error(err);
      showAppToast('Şablon hatası: ' + err.message, 'error');
    }
  };

  // Dosya nesnesini alıp panele ekler (Dosya > Aç'tan çağrılır)
  window.udfManagerLoadFile = function (file, fileHandle) {
    loadUdfFromFile(file, fileHandle || null);
    togglePanel(true);
  };

  // Aktif dosyayı kaydetme API'si (app.js'den çağrılabilir)
  window.udfManagerSaveActivePublic = function () {
    return saveActive();
  };

  // ===== Init =====

  // Uygulama ilk açıldığında panele otomatik bir başlangıç belgesi ekle.
  // localStorage'da otomatik kaydedilmiş içerik varsa onu, yoksa boş belge açar.
  (function createInitialDocument() {
    const editorEl = document.getElementById('editor');
    const titleEl  = document.getElementById('documentTitle');

    // app.js localStorage yüklemesini bekle (microtask sonrası çalışır)
    setTimeout(() => {
      if (udfFiles.length > 0) return; // Zaten dosya var (reload sonrası vb.)

      let existingHtml = '';
      if (window.PaginationManager) {
        existingHtml = window.PaginationManager.getAllContentHTML().trim();
      } else {
        const editorEl = document.getElementById('editor');
        existingHtml = editorEl ? editorEl.innerHTML.trim() : '';
      }
      const existingTitle = titleEl   ? titleEl.value.trim()       : '';

      // Editörde gerçek içerik var mı? (sadece <p><br></p> veya boş ise yok say)
      const hasContent = existingHtml &&
        existingHtml !== '<p><br></p>' &&
        existingHtml !== '<br>' &&
        existingHtml.replace(/<[^>]*>/g, '').trim() !== '';

      const id   = nextId++;
      const name = (hasContent && existingTitle && existingTitle !== 'Adsız Doküman')
        ? existingTitle + '.udf'
        : 'Adsız-' + id + '.udf';

      udfFiles.push({
        id,
        name,
        html:        hasContent ? existingHtml : '<p><br></p>',
        headerHtml:  '',
        footerHtml:  '',
        hasHeader:   false,
        hasFooter:   false,
        contentXml:  '',
        fileHandle:  null,
        signature:   null,
        signerName:  null,
        dirty:       hasContent  // localStorage'dan geliyorsa değiştirilmiş say
      });

      activeId = id;
      renderFileList();

      // Paneldeki ismi başlık çubuğuyla senkronize et
      if (titleEl && !hasContent) titleEl.value = name.replace(/\.udf$/i, '');
    }, 0);
  })();

  renderFileList();
  togglePanel(true); // Panel açık başlasın

  console.log('[UDF Manager] Hazır —',
    'FSA_OPEN:', FSA_OPEN,
    '| FSA_WRITE:', FSA_WRITE,
    '| FSA_SAVE_DIALOG:', FSA_SAVE_DIALOG,
    '| IS_SECURE:', IS_SECURE
  );
})();
