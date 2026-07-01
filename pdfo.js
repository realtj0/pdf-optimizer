// PDFO core: orphan-object stripping + 300dpi image downsampling.
// Pure pdf-lib + canvas, no server, no pdf.js dependency.

(function (global) {
  const {
    PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFStream,
    decodePDFRawStream,
  } = PDFLib;

  const IDENTITY = [1, 0, 0, 1, 0, 0];

  function multiply(m1, m2) {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [
      a1 * a2 + b1 * c2,
      a1 * b2 + b1 * d2,
      c1 * a2 + d1 * c2,
      c1 * b2 + d1 * d2,
      e1 * a2 + f1 * c2 + e2,
      e1 * b2 + f1 * d2 + f2,
    ];
  }

  function refKey(ref) {
    return ref.objectNumber + '_' + ref.generationNumber;
  }

  function refsEqual(a, b) {
    return a instanceof PDFRef && b instanceof PDFRef &&
      a.objectNumber === b.objectNumber && a.generationNumber === b.generationNumber;
  }

  function resolve(context, val) {
    return val instanceof PDFRef ? context.lookup(val) : val;
  }

  function getInherited(context, dict, key) {
    let node = dict;
    const seen = new Set();
    while (node instanceof PDFDict && !seen.has(node)) {
      seen.add(node);
      const val = node.get(PDFName.of(key));
      if (val !== undefined) return resolve(context, val);
      node = resolve(context, node.get(PDFName.of('Parent')));
    }
    return undefined;
  }

  // --- Content-stream tokenizer (numbers, names, operators; strings/arrays/
  // dicts/inline-images are skipped as opaque since we only need cm/q/Q/Do) ---
  function tokenize(bytes) {
    const tokens = [];
    const n = bytes.length;
    let i = 0;
    const isWs = c => c === 0x20 || c === 0x0A || c === 0x0D || c === 0x09 || c === 0x0C || c === 0x00;
    const isDelim = c => c === 0x28 || c === 0x29 || c === 0x3C || c === 0x3E || c === 0x5B || c === 0x5D || c === 0x7B || c === 0x7D || c === 0x2F || c === 0x25;
    const str = (a, b) => new TextDecoder('latin1').decode(bytes.subarray(a, b));

    while (i < n) {
      const c = bytes[i];
      if (isWs(c)) { i++; continue; }
      if (c === 0x25) { while (i < n && bytes[i] !== 0x0A && bytes[i] !== 0x0D) i++; continue; }
      if (c === 0x2F) {
        let j = i + 1;
        while (j < n && !isWs(bytes[j]) && !isDelim(bytes[j])) j++;
        tokens.push({ t: 'name', v: str(i + 1, j) });
        i = j; continue;
      }
      if (c === 0x28) {
        let depth = 1, j = i + 1;
        while (j < n && depth > 0) {
          if (bytes[j] === 0x5C) { j += 2; continue; }
          if (bytes[j] === 0x28) depth++;
          else if (bytes[j] === 0x29) depth--;
          j++;
        }
        tokens.push({ t: 'skip' });
        i = j; continue;
      }
      if (c === 0x3C) {
        if (bytes[i + 1] === 0x3C) {
          let depth = 1, j = i + 2;
          while (j < n && depth > 0) {
            if (bytes[j] === 0x3C && bytes[j + 1] === 0x3C) { depth++; j += 2; continue; }
            if (bytes[j] === 0x3E && bytes[j + 1] === 0x3E) { depth--; j += 2; continue; }
            j++;
          }
          tokens.push({ t: 'skip' });
          i = j; continue;
        }
        let j = i + 1;
        while (j < n && bytes[j] !== 0x3E) j++;
        tokens.push({ t: 'skip' });
        i = j + 1; continue;
      }
      if (c === 0x5B) {
        let depth = 1, j = i + 1;
        while (j < n && depth > 0) {
          if (bytes[j] === 0x5B) depth++;
          else if (bytes[j] === 0x5D) depth--;
          else if (bytes[j] === 0x28) {
            let d2 = 1, k = j + 1;
            while (k < n && d2 > 0) {
              if (bytes[k] === 0x5C) { k += 2; continue; }
              if (bytes[k] === 0x28) d2++;
              else if (bytes[k] === 0x29) d2--;
              k++;
            }
            j = k; continue;
          }
          j++;
        }
        tokens.push({ t: 'skip' });
        i = j; continue;
      }
      if (c === 0x7B || c === 0x7D) { i++; continue; }
      let j = i;
      while (j < n && !isWs(bytes[j]) && !isDelim(bytes[j])) j++;
      const s = str(i, j);
      if (s === 'ID') {
        tokens.push({ t: 'op', v: 'ID' });
        let k = j;
        if (k < n && isWs(bytes[k])) k++;
        while (k < n - 1) {
          if ((k === 0 || isWs(bytes[k - 1])) && bytes[k] === 0x45 && bytes[k + 1] === 0x49 &&
              (k + 2 >= n || isWs(bytes[k + 2]) || isDelim(bytes[k + 2]))) break;
          k++;
        }
        i = Math.min(k + 2, n);
        continue;
      }
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) tokens.push({ t: 'num', v: parseFloat(s) });
      else tokens.push({ t: 'op', v: s });
      i = j;
    }
    return tokens;
  }

  function decodeStreamBytes(streamObj) {
    const decoded = decodePDFRawStream(streamObj);
    return typeof decoded.decode === 'function' ? decoded.decode() : decoded;
  }

  function getContentsBytes(context, pageDict) {
    const contents = resolve(context, pageDict.get(PDFName.of('Contents')));
    if (!contents) return new Uint8Array(0);
    const chunks = [];
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const s = resolve(context, contents.get(i));
        if (s) chunks.push(decodeStreamBytes(s));
      }
    } else {
      chunks.push(decodeStreamBytes(contents));
    }
    const total = chunks.reduce((n, c) => n + c.length + 1, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; out[off] = 0x0A; off++; }
    return out;
  }

  // Walks operators tracking the CTM; records max on-page display size (in
  // points) per image XObject ref; recurses into Form XObjects.
  function interpretStream(context, bytes, resources, ctm, usage, depth) {
    if (depth > 12 || !resources) return;
    const xobjDict = resolve(context, resources.get(PDFName.of('XObject')));
    const tokens = tokenize(bytes);
    const stack = [];
    const ctmStack = [];
    let cur = ctm;

    for (const tok of tokens) {
      if (tok.t === 'num' || tok.t === 'name') { stack.push(tok); continue; }
      if (tok.t === 'skip') { stack.push(tok); continue; }
      // operator
      const op = tok.v;
      if (op === 'q') { ctmStack.push(cur); }
      else if (op === 'Q') { if (ctmStack.length) cur = ctmStack.pop(); }
      else if (op === 'cm' && stack.length >= 6) {
        const nums = stack.slice(-6).map(t => t.v);
        cur = multiply(nums, cur);
      } else if (op === 'Do' && stack.length >= 1 && xobjDict) {
        const nameTok = stack[stack.length - 1];
        if (nameTok.t === 'name') {
          const ref = xobjDict.get(PDFName.of(nameTok.v));
          if (ref instanceof PDFRef) {
            let xobj;
            try { xobj = context.lookup(ref); } catch (e) { xobj = null; }
            if (xobj && xobj.dict) {
              const subtype = xobj.dict.get(PDFName.of('Subtype'));
              const subtypeStr = subtype ? subtype.toString() : '';
              if (subtypeStr === '/Image') {
                const w = Math.hypot(cur[0], cur[1]);
                const h = Math.hypot(cur[2], cur[3]);
                const key = refKey(ref);
                const existing = usage.get(key);
                if (!existing) usage.set(key, { ref, maxWPt: w, maxHPt: h });
                else { existing.maxWPt = Math.max(existing.maxWPt, w); existing.maxHPt = Math.max(existing.maxHPt, h); }
              } else if (subtypeStr === '/Form') {
                const matrixArr = resolve(context, xobj.dict.get(PDFName.of('Matrix')));
                let m = IDENTITY;
                if (matrixArr instanceof PDFArray && matrixArr.size() === 6) {
                  m = [0, 1, 2, 3, 4, 5].map(i => matrixArr.get(i).asNumber());
                }
                const formResources = resolve(context, xobj.dict.get(PDFName.of('Resources'))) || resources;
                try {
                  const formBytes = decodeStreamBytes(xobj);
                  interpretStream(context, formBytes, formResources, multiply(m, cur), usage, depth + 1);
                } catch (e) { /* skip malformed form */ }
              }
            }
          }
        }
      }
      stack.length = 0;
    }
  }

  function computeImageUsage(pdfDoc) {
    const { context } = pdfDoc;
    const usage = new Map();
    for (const page of pdfDoc.getPages()) {
      try {
        const pageDict = page.node;
        const resources = getInherited(context, pageDict, 'Resources');
        const bytes = getContentsBytes(context, pageDict);
        interpretStream(context, bytes, resources, IDENTITY, usage, 0);
      } catch (e) { /* skip page on parse error */ }
    }
    return usage;
  }

  // --- Mark-and-sweep GC: delete every indirect object unreachable from the
  // trailer/catalog. pdf-lib's save() never does this on its own. ---
  // Recurses into directly-embedded (non-indirect) dicts/arrays too — e.g.
  // /Resources or /Resources/XObject is very often a direct dict, so a ref
  // to an image can sit two or three levels below the object we're scanning.
  function collectRefs(obj, out, seen) {
    seen = seen || new Set();
    if (obj instanceof PDFDict || obj instanceof PDFArray) {
      if (seen.has(obj)) return;
      seen.add(obj);
    }
    if (obj instanceof PDFDict) {
      for (const [, val] of obj.entries()) {
        if (val instanceof PDFRef) out.push(val);
        else collectRefs(val, out, seen);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const val = obj.get(i);
        if (val instanceof PDFRef) out.push(val);
        else collectRefs(val, out, seen);
      }
    }
    if (obj && obj.dict instanceof PDFDict) collectRefs(obj.dict, out, seen);
  }

  function runGC(pdfDoc) {
    const { context } = pdfDoc;
    const reachable = new Set();
    const seeds = [context.trailerInfo.Root];
    if (context.trailerInfo.Info) seeds.push(context.trailerInfo.Info);
    const stack = seeds.filter(Boolean);
    while (stack.length) {
      const ref = stack.pop();
      if (!(ref instanceof PDFRef)) continue;
      const key = refKey(ref);
      if (reachable.has(key)) continue;
      reachable.add(key);
      let obj;
      try { obj = context.lookup(ref); } catch (e) { continue; }
      const refs = [];
      collectRefs(obj, refs);
      stack.push(...refs);
    }
    let removed = 0;
    for (const [ref] of context.enumerateIndirectObjects()) {
      if (!reachable.has(refKey(ref))) { context.delete(ref); removed++; }
    }
    return removed;
  }

  function replaceRefIn(obj, oldRef, newRef, seen) {
    if (obj instanceof PDFDict || obj instanceof PDFArray) {
      if (seen.has(obj)) return;
      seen.add(obj);
    }
    if (obj instanceof PDFDict) {
      for (const [key, val] of obj.entries()) {
        if (refsEqual(val, oldRef)) obj.set(key, newRef);
        else replaceRefIn(val, oldRef, newRef, seen);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const val = obj.get(i);
        if (refsEqual(val, oldRef)) obj.set(i, newRef);
        else replaceRefIn(val, oldRef, newRef, seen);
      }
    }
    if (obj && obj.dict instanceof PDFDict) replaceRefIn(obj.dict, oldRef, newRef, seen);
  }

  function replaceRefEverywhere(context, oldRef, newRef) {
    const seen = new Set();
    for (const [, obj] of context.enumerateIndirectObjects()) replaceRefIn(obj, oldRef, newRef, seen);
  }

  function num(context, val) {
    const v = resolve(context, val);
    return v && typeof v.asNumber === 'function' ? v.asNumber() : undefined;
  }

  async function downsampleImages(pdfDoc, usage, targetDpi, report) {
    const { context } = pdfDoc;
    for (const { ref, maxWPt, maxHPt } of usage.values()) {
      let xobj;
      try { xobj = context.lookup(ref); } catch (e) { continue; }
      if (!(xobj instanceof PDFRawStream)) continue;
      const dict = xobj.dict;
      const widthPx = num(context, dict.get(PDFName.of('Width')));
      const heightPx = num(context, dict.get(PDFName.of('Height')));
      if (!widthPx || !heightPx || maxWPt <= 0 || maxHPt <= 0) continue;

      if (dict.get(PDFName.of('SMask')) || dict.get(PDFName.of('Mask'))) {
        report.skipped.push({ widthPx, heightPx, reason: 'has transparency (SMask/Mask), not yet supported' });
        continue;
      }

      const targetW = Math.min(widthPx, Math.max(1, Math.ceil((maxWPt / 72) * targetDpi)));
      const targetH = Math.min(heightPx, Math.max(1, Math.ceil((maxHPt / 72) * targetDpi)));
      if (targetW >= widthPx * 0.95 && targetH >= heightPx * 0.95) continue; // already <=~300dpi

      let filterName = dict.get(PDFName.of('Filter'));
      if (filterName instanceof PDFArray) filterName = filterName.get(filterName.size() - 1);
      const filterStr = filterName ? filterName.toString() : '';

      let bitmap;
      if (filterStr === '/DCTDecode') {
        // The raw (still-encoded) stream bytes ARE a valid JPEG file already —
        // decodePDFRawStream doesn't apply here (and throws), it's for the
        // generic text filters (Flate/LZW/...), not image codecs.
        try {
          const blob = new Blob([xobj.contents], { type: 'image/jpeg' });
          bitmap = await createImageBitmap(blob);
        } catch (e) {
          report.skipped.push({ widthPx, heightPx, reason: 'JPEG decode failed' });
          continue;
        }
      } else if (filterStr === '/JPXDecode' || filterStr === '/CCITTFaxDecode' || filterStr === '/JBIG2Decode') {
        report.skipped.push({ widthPx, heightPx, reason: 'unsupported encoding ' + filterStr });
        continue;
      } else {
        const colorSpace = dict.get(PDFName.of('ColorSpace'));
        const bpc = num(context, dict.get(PDFName.of('BitsPerComponent')));
        const csName = colorSpace ? colorSpace.toString() : '';
        if (bpc !== 8 || (csName !== '/DeviceRGB' && csName !== '/DeviceGray')) {
          report.skipped.push({ widthPx, heightPx, reason: 'unsupported raw color space/bit depth' });
          continue;
        }
        let bytes;
        try { bytes = decodeStreamBytes(xobj); } catch (e) {
          report.skipped.push({ widthPx, heightPx, reason: 'stream decode failed' });
          continue;
        }
        const comps = csName === '/DeviceRGB' ? 3 : 1;
        const expected = widthPx * heightPx * comps;
        if (bytes.length < expected) {
          report.skipped.push({ widthPx, heightPx, reason: 'raw sample data shorter than expected' });
          continue;
        }
        const rgba = new Uint8ClampedArray(widthPx * heightPx * 4);
        for (let p = 0; p < widthPx * heightPx; p++) {
          if (comps === 3) {
            rgba[p * 4] = bytes[p * 3]; rgba[p * 4 + 1] = bytes[p * 3 + 1]; rgba[p * 4 + 2] = bytes[p * 3 + 2];
          } else {
            const v = bytes[p]; rgba[p * 4] = v; rgba[p * 4 + 1] = v; rgba[p * 4 + 2] = v;
          }
          rgba[p * 4 + 3] = 255;
        }
        const srcCanvas = new OffscreenCanvas(widthPx, heightPx);
        srcCanvas.getContext('2d').putImageData(new ImageData(rgba, widthPx, heightPx), 0, 0);
        bitmap = await createImageBitmap(srcCanvas);
      }

      const outCanvas = new OffscreenCanvas(targetW, targetH);
      const ctx2d = outCanvas.getContext('2d');
      ctx2d.imageSmoothingEnabled = true;
      ctx2d.imageSmoothingQuality = 'high';
      ctx2d.drawImage(bitmap, 0, 0, targetW, targetH);
      const outBlob = await outCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
      const outBytes = new Uint8Array(await outBlob.arrayBuffer());

      let embedded;
      try { embedded = await pdfDoc.embedJpg(outBytes); } catch (e) { continue; }
      replaceRefEverywhere(context, ref, embedded.ref);
      report.downsampled.push({ widthPx, heightPx, newWidthPx: targetW, newHeightPx: targetH });
    }
  }

  async function optimize(arrayBuffer, opts) {
    const targetDpi = (opts && opts.targetDpi) || 300;
    const originalSize = arrayBuffer.byteLength;
    const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true, updateMetadata: false });

    const usage = computeImageUsage(pdfDoc);
    const report = { downsampled: [], skipped: [], orphansRemoved: 0, originalSize, finalSize: 0 };
    await downsampleImages(pdfDoc, usage, targetDpi, report);
    report.orphansRemoved = runGC(pdfDoc);

    const bytes = await pdfDoc.save({ useObjectStreams: true });
    report.finalSize = bytes.byteLength;
    return { bytes, report };
  }

  global.PDFO = { optimize };
})(window);
