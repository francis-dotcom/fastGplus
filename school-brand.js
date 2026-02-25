/**
 * Single source of truth for the school name.
 * Edit this file only; all pages and the mobile menu will use it.
 */
(function () {
  'use strict';

  window.SCHOOL_BRAND = {
    line1: 'GRAND-PLUS COLLEGE',
    line2: 'OF',
    line3: 'EDUCATION',
    alt: 'Grand-Plus College of Education',
    titleSuffix: 'Grand Plus College'
  };

  function getSchoolBrandHtml() {
    var b = window.SCHOOL_BRAND;
    return '<span class="school-name__line1">' + escapeHtml(b.line1) + '</span>' +
      '<span class="school-name__line2">' + escapeHtml(b.line2) + '</span>' +
      '<span class="school-name__line3">' + escapeHtml(b.line3) + '</span>';
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function applyBrand() {
    var nodes = document.querySelectorAll('[data-school-brand]');
    nodes.forEach(function (el) {
      el.innerHTML = getSchoolBrandHtml();
    });
    document.querySelectorAll('img.logo-img').forEach(function (img) {
      img.setAttribute('alt', window.SCHOOL_BRAND.alt);
    });
    var titleMeta = document.querySelector('meta[name="school-brand-title-prefix"]');
    if (titleMeta && titleMeta.content) {
      document.title = titleMeta.content + window.SCHOOL_BRAND.alt;
    }
  }

  window.getSchoolBrandHtml = getSchoolBrandHtml;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBrand);
  } else {
    applyBrand();
  }
})();
