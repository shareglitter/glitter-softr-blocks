# Share Button Fix - Visitor + Logged-In Block Info

## What changed
- Replaced inline `onclick` with a proper `gcShareBlock()` function
- Copies the block's short URL (gltr.ly link from `Block Page URL` field) instead of the raw browser URL
- Shows a toast notification instead of `alert()`
- On mobile, uses native share sheet with the block name and short URL
- Toast auto-fades after 2 seconds

## Where to apply

### 1. VISITOR block info (`softr-block-info-merged-v2.html`)

**Replace this share button HTML:**
```html
<a class="share-btn"
   href="javascript:void(0)"
   onclick="navigator.share ? navigator.share({title:'Glitter Block', url:window.location.href}) : navigator.clipboard.writeText(window.location.href).then(function(){alert('Link copied!')})">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16 6 12 2 8 6"/>
    <line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
  Share This Page
</a>
```

**With this:**
```html
<button class="share-btn" type="button" onclick="gcShareBlock()">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16 6 12 2 8 6"/>
    <line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
  <span id="gcShareBtnText">Share This Page</span>
</button>
```

**Add this CSS (in the existing `<style>` block):**
```css
.share-btn .gc-share-toast {
  color: #157275;
}
```

**Add this JS (in the existing `<script>` block, before the IIFE closing):**
```javascript
/* ---- SHARE BUTTON ---- */
window.gcShareBlock = function() {
  var record = window.glitterRecord || {};
  var blockName = record['Block Name (Full)'] || document.querySelector('.block-headline-title');
  if (blockName && blockName.textContent) blockName = blockName.textContent.trim();
  blockName = blockName || 'our block';

  // Build the share URL: prefer the short gltr.ly link, fall back to current page
  var rawUrl = record['Block Page URL'] || '';
  var shareUrl = rawUrl && rawUrl.indexOf('{{') === -1
    ? (rawUrl.match(/^https?:\/\//) ? rawUrl : 'https://' + rawUrl)
    : window.location.href;

  var shareText = 'Check out ' + blockName + ' on Glitter! Neighbors chip in and a local cleaner keeps it clean every week.';
  var btnTextEl = document.getElementById('gcShareBtnText');

  // Mobile: use native share sheet
  var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile && navigator.share) {
    navigator.share({
      title: blockName + ' on Glitter',
      text: shareText,
      url: shareUrl,
    }).catch(function() {}); // user cancelled, no-op
    return;
  }

  // Desktop: copy link with toast
  if (navigator.clipboard) {
    navigator.clipboard.writeText(shareUrl).then(function() {
      if (btnTextEl) {
        btnTextEl.textContent = 'Link Copied!';
        setTimeout(function() { btnTextEl.textContent = 'Share This Page'; }, 2000);
      }
    }).catch(function() {
      prompt('Copy this link:', shareUrl);
    });
  } else {
    prompt('Copy this link:', shareUrl);
  }
};
```

---

### 2. LOGGED-IN block info (`softr-block-info-loggedin.html`)

Same fix. Replace the share button `<a>` tag:

```html
<a class="share-btn-li" href="javascript:void(0)"
  onclick="navigator.share ? navigator.share({title:'Glitter Block', url:window.location.href}) : navigator.clipboard.writeText(window.location.href).then(function(){alert('Link copied!')})">
```

**With:**
```html
<button class="share-btn-li" type="button" onclick="gcShareBlock()">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round">
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
  <span id="gcShareBtnTextLI">Share This Page</span>
</button>
```

And add the same `gcShareBlock` function to the logged-in script (or since both blocks are on the same page, the visitor block's function will already be available via `window.gcShareBlock`). Just update the button text element ID reference.

Actually, since both blocks live on the same Softr page (one hidden by visibility rules), the single `gcShareBlock` function defined in the visitor block will work for both. Just make sure the logged-in button also has a text span for the toast. Update the function to check both IDs:

```javascript
// In gcShareBlock, replace the btnTextEl line with:
var btnTextEl = document.getElementById('gcShareBtnText') || document.getElementById('gcShareBtnTextLI');
```

Or simpler: use the same ID on both (only one renders at a time since they're visibility-toggled).