const catalog = Array.isArray(window.catalogData) ? window.catalogData : [];
const catalogContainer = document.querySelector("#catalogContainer");
const jumpList = document.querySelector("#jumpList");
const searchInput = document.querySelector("#searchInput");
const filterBar = document.querySelector("#filterBar");
const yearNode = document.querySelector("#year");
const emptyState = document.querySelector("#emptyState");

let activeFilter = "all";
let activeQuery = "";

function normalizeChapter(chapter) {
  if (typeof chapter === "string") {
    return {
      title: chapter,
      demo: null,
    };
  }

  return {
    title: chapter.title || "",
    demo: chapter.demo || null,
  };
}

function createChapterCard(chapter, index) {
  const normalized = normalizeChapter(chapter);
  const title = normalized.title;
  const demo = normalized.demo;
  const demoMarkup = demo
    ? `
      <div class="chapter-actions">
        <a class="chapter-link" href="${demo.href}">${demo.label}</a>
        ${
          demo.download
            ? `<a class="chapter-link chapter-download" href="${demo.download}" download>下载</a>`
            : ""
        }
      </div>
      <span class="chapter-placeholder">${demo.summary || "已添加演示"}</span>
    `
    : `
      <span class="chapter-placeholder">演示条目预留</span>
      <span class="chapter-empty">未添加</span>
    `;

  return `
    <article class="chapter-card" data-search="${title} ${demo?.label || ""} ${demo?.summary || ""}">
      <p class="chapter-index">Chapter ${String(index + 1).padStart(2, "0")}</p>
      <h3>${title}</h3>
      <div class="chapter-meta">
        ${demoMarkup}
      </div>
    </article>
  `;
}

function renderJumpList() {
  if (!jumpList) {
    return;
  }

  jumpList.innerHTML = catalog
    .map(
      (book) => `
        <a class="jump-link" href="#${book.id}">
          <span>${book.title}</span>
          <span>${book.chapters.length} 章</span>
        </a>
      `
    )
    .join("");
}

function renderCatalog() {
  if (!catalogContainer) {
    return;
  }

  catalogContainer.innerHTML = catalog
    .map(
      (book) => `
        <section class="book-section reveal" id="${book.id}" data-type="${book.type}">
          <div class="book-head">
            <div>
              <p class="book-label">${book.type}</p>
              <h2 class="book-title">${book.title}</h2>
            </div>
            <span class="book-stat">${book.chapters.length} 章</span>
          </div>
          <div class="chapter-grid">
            ${book.chapters.map((chapter, index) => createChapterCard(chapter, index)).join("")}
          </div>
        </section>
      `
    )
    .join("");

  attachRevealObserver();
  applyFilters();
}

function applyFilters() {
  const sections = document.querySelectorAll(".book-section");
  let visibleSections = 0;

  sections.forEach((section) => {
    const sectionType = section.dataset.type || "";
    const matchesFilter = activeFilter === "all" || sectionType === activeFilter;
    let hasVisibleChapter = false;

    section.querySelectorAll(".chapter-card").forEach((card) => {
      const text = `${section.id} ${sectionType} ${section.querySelector(".book-title")?.textContent || ""} ${card.dataset.search || ""}`;
      const matchesQuery = activeQuery === "" || text.toLowerCase().includes(activeQuery);
      card.classList.toggle("is-hidden", !(matchesFilter && matchesQuery));
      if (matchesFilter && matchesQuery) {
        hasVisibleChapter = true;
      }
    });

    const shouldHide = !matchesFilter || !hasVisibleChapter;
    section.classList.toggle("is-hidden", shouldHide);
    if (!shouldHide) {
      visibleSections += 1;
    }
  });

  if (emptyState) {
    emptyState.classList.toggle("is-hidden", visibleSections !== 0);
  }
}

function attachFilterEvents() {
  if (!filterBar) {
    return;
  }

  filterBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) {
      return;
    }

    activeFilter = button.dataset.filter || "all";
    filterBar.querySelectorAll("[data-filter]").forEach((chip) => {
      chip.classList.toggle("is-active", chip === button);
    });
    applyFilters();
  });
}

function attachSearchEvent() {
  if (!searchInput) {
    return;
  }

  searchInput.addEventListener("input", (event) => {
    activeQuery = event.target.value.trim().toLowerCase();
    applyFilters();
  });
}

function attachRevealObserver() {
  const revealItems = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        }
      });
    },
    {
      threshold: 0.14,
    }
  );

  revealItems.forEach((item, index) => {
    item.style.transitionDelay = `${index * 40}ms`;
    observer.observe(item);
  });
}

function initYear() {
  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }
}

renderJumpList();
renderCatalog();
attachFilterEvents();
attachSearchEvent();
initYear();
