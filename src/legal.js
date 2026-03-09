import {initSiteFooter} from "./site-footer";

function initLegalToc() {
  const links = Array.from(document.querySelectorAll('.legal-toc a[href^="#"]'));
  if (!links.length) return;

  const setActiveLink = (id) => {
    links.forEach((link) => {
      const active = link.hash === `#${id}`;
      if (active) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const sections = links
    .map((link) => document.querySelector(link.hash))
    .filter((section) => section instanceof HTMLElement);

  if (!sections.length) return;

  const initialId = window.location.hash.replace(/^#/, "") || sections[0].id;
  setActiveLink(initialId);

  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (visibleEntry?.target instanceof HTMLElement) {
        setActiveLink(visibleEntry.target.id);
      }
    },
    {
      rootMargin: "-28% 0px -58% 0px",
      threshold: [0.15, 0.4, 0.7],
    },
  );

  sections.forEach((section) => observer.observe(section));
  window.addEventListener("hashchange", () => {
    const nextId = window.location.hash.replace(/^#/, "");
    if (nextId) setActiveLink(nextId);
  });
}

initSiteFooter();
initLegalToc();
