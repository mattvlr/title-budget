document.addEventListener('DOMContentLoaded', function() {
    const wikiSearch = document.getElementById('wikiSearch');
    const tableOfContents = document.getElementById('tableOfContents');
    const expandAllBtn = document.getElementById('expandAllBtn');
    const collapseAllBtn = document.getElementById('collapseAllBtn');
    const filterButtons = document.querySelectorAll('.wiki-filter-chip');
    const searchInfo = document.getElementById('searchInfo');
    const matchCount = document.getElementById('matchCount');
    const matchCountPlural = document.getElementById('matchCountPlural');
    const searchTerm = document.getElementById('searchTerm');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const tocToggle = document.getElementById('tocToggle');
    const tocNav = document.querySelector('.wiki-toc-nav');
    const currentSection = document.getElementById('currentSection');

    // Configuration
    const searchDebounceMs = 300;
    let searchTimeout;
    let activeAudience = 'all';

    // ============================================
    // Generate Table of Contents
    // ============================================

    function generateTableOfContents() {
        const sections = document.querySelectorAll('.wiki-section');
        tableOfContents.innerHTML = '';

        sections.forEach((section, sectionIndex) => {
            const heading = section.querySelector('.wiki-heading-2');
            if (!heading) return;

            const sectionId = section.id;
            const sectionTitle = heading.textContent.trim();
            const sectionLevel = 1;

            // Main section link
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#' + sectionId;
            a.textContent = sectionTitle;
            a.addEventListener('click', (e) => {
                e.preventDefault();
                scrollToSection(sectionId);
                updateBreadcrumb(sectionTitle);
            });

            li.appendChild(a);

            // Add subsection links for guide cards
            const cards = section.querySelectorAll('[id^="guide-"], [id^="trouble-"]');
            if (cards.length > 0) {
                const subList = document.createElement('ol');
                subList.style.paddingLeft = '1.2rem';
                subList.style.marginTop = '4px';
                subList.style.fontSize = '0.85rem';

                cards.forEach((card) => {
                    const title = card.querySelector('.wiki-guide-title');
                    if (!title) return;

                    const subLi = document.createElement('li');
                    const subA = document.createElement('a');
                    subA.href = '#' + card.id;
                    subA.textContent = title.textContent.trim();
                    subA.style.display = 'block';
                    subA.style.padding = '4px 6px';

                    subA.addEventListener('click', (e) => {
                        e.preventDefault();
                        scrollToSection(card.id);
                        updateBreadcrumb(title.textContent.trim());
                    });

                    subLi.appendChild(subA);
                    subList.appendChild(subLi);
                });

                li.appendChild(subList);
            }

            tableOfContents.appendChild(li);
        });
    }

    // ============================================
    // Search Functionality
    // ============================================

    function debounce(func, wait) {
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(searchTimeout);
                func(...args);
            };
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(later, wait);
        };
    }

    function highlightSearchTerm(element, query) {
        if (!query) return;

        const regex = new RegExp(`(${query})`, 'gi');
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const nodesToReplace = [];
        let node;

        while ((node = walker.nextNode())) {
            if (regex.test(node.textContent)) {
                nodesToReplace.push(node);
            }
        }

        nodesToReplace.forEach((textNode) => {
            const span = document.createElement('span');
            span.innerHTML = textNode.textContent.replace(
                new RegExp(`(${query})`, 'gi'),
                '<span class="wiki-search-highlight">$1</span>'
            );
            textNode.parentNode.replaceChild(span, textNode);
        });
    }

    function clearHighlights(element) {
        const highlights = element.querySelectorAll('.wiki-search-highlight');
        highlights.forEach((highlight) => {
            const parent = highlight.parentNode;
            while (highlight.firstChild) {
                parent.insertBefore(highlight.firstChild, highlight);
            }
            parent.removeChild(highlight);
        });
    }

    function performSearch(query) {
        const allCards = document.querySelectorAll('[data-audience]');
        let visibleCount = 0;

        allCards.forEach((card) => {
            clearHighlights(card);

            const text = card.innerText.toLowerCase();
            const matchesSearch = !query || text.includes(query.toLowerCase());
            const matchesAudience = activeAudience === 'all' || card.getAttribute('data-audience') === activeAudience;
            const isVisible = matchesSearch && matchesAudience;

            card.hidden = !isVisible;

            if (isVisible) {
                visibleCount++;
                if (query) {
                    highlightSearchTerm(card, query);
                }
            }
        });

        // Update search info display
        if (query) {
            searchInfo.style.display = 'block';
            matchCount.textContent = visibleCount;
            matchCountPlural.textContent = visibleCount === 1 ? '' : 's';
            searchTerm.textContent = `"${query}"`;
        } else {
            searchInfo.style.display = 'none';
        }

        // Hide sections with no visible content
        const sections = document.querySelectorAll('.wiki-section');
        sections.forEach((section) => {
            const visibleInSection = section.querySelectorAll('[data-audience]:not([hidden])').length;
            section.style.display = visibleInSection > 0 || !query ? 'block' : 'none';
        });
    }

    const debouncedSearch = debounce(performSearch, searchDebounceMs);

    if (wikiSearch) {
        wikiSearch.addEventListener('input', (e) => {
            debouncedSearch(e.target.value.trim());
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            wikiSearch.value = '';
            performSearch('');
            wikiSearch.focus();
        });
    }

    // ============================================
    // Audience Filter
    // ============================================

    filterButtons.forEach((button) => {
        button.addEventListener('click', () => {
            filterButtons.forEach((b) => b.classList.remove('active'));
            button.classList.add('active');
            activeAudience = button.getAttribute('data-audience');

            // Re-run search with new audience filter
            performSearch(wikiSearch.value.trim());
        });
    });

    // ============================================
    // Expand/Collapse All
    // ============================================

    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            const allDetails = document.querySelectorAll('.wiki-details:not([hidden] .wiki-details)');
            allDetails.forEach((details) => {
                if (!details.closest('[hidden]')) {
                    details.open = true;
                }
            });
        });
    }

    if (collapseAllBtn) {
        collapseAllBtn.addEventListener('click', () => {
            const allDetails = document.querySelectorAll('.wiki-details');
            allDetails.forEach((details) => {
                details.open = false;
            });
        });
    }

    // ============================================
    // Smooth Scroll to Section
    // ============================================

    function scrollToSection(id) {
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // ============================================
    // Active TOC Tracking on Scroll
    // ============================================

    function updateTOCActiveState() {
        const sections = document.querySelectorAll('.wiki-section');
        let currentId = '';

        sections.forEach((section) => {
            const rect = section.getBoundingClientRect();
            // Check if section is in viewport
            if (rect.top <= window.innerHeight / 2 && rect.bottom >= 0) {
                currentId = section.id;
            }
        });

        // Update active state in TOC
        const tocLinks = document.querySelectorAll('.wiki-toc-nav a');
        tocLinks.forEach((link) => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + currentId) {
                link.classList.add('active');
            }
        });
    }

    window.addEventListener('scroll', updateTOCActiveState, { passive: true });

    // ============================================
    // Hash-based Navigation
    // ============================================

    function handleHashNavigation() {
        const hash = window.location.hash.slice(1);
        if (hash) {
            setTimeout(() => {
                scrollToSection(hash);
                const element = document.getElementById(hash);
                if (element) {
                    const title = element.querySelector('.wiki-heading-2, .wiki-guide-title');
                    if (title) {
                        updateBreadcrumb(title.textContent.trim());
                    }
                }
            }, 100);
        }
    }

    window.addEventListener('hashchange', handleHashNavigation);
    handleHashNavigation();

    // ============================================
    // Update Breadcrumb
    // ============================================

    function updateBreadcrumb(sectionName) {
        if (currentSection) {
            currentSection.textContent = sectionName;
        }
    }

    // ============================================
    // Mobile TOC Toggle
    // ============================================

    if (tocToggle) {
        tocToggle.addEventListener('click', () => {
            if (tocNav) {
                tocNav.classList.toggle('visible');
            }
        });
    }

    // Close TOC when clicking a link on mobile
    if (tocNav) {
        const tocLinks = tocNav.querySelectorAll('a');
        tocLinks.forEach((link) => {
            link.addEventListener('click', () => {
                if (window.innerWidth < 992) {
                    tocNav.classList.remove('visible');
                }
            });
        });
    }

    // ============================================
    // Initialize
    // ============================================

    generateTableOfContents();
    updateTOCActiveState();
});
