(function() {
  "use strict";

  const select = (el, all = false) => {
    el = el.trim()
    if (all) {
      return [...document.querySelectorAll(el)]
    } else {
      return document.querySelector(el)
    }
  }

  /* Easy event listener function */
  const on = (type, el, listener, all = false) => {
    let selectEl = select(el, all)
    if (selectEl) {
      if (all) {
        selectEl.forEach(e => e.addEventListener(type, listener))
      } else {
        selectEl.addEventListener(type, listener)
      }
    }
  }

  /* Easy on scroll event listener */
  const onscroll = (el, listener) => {
    el.addEventListener('scroll', listener)
  }

  /* Keep decorative background videos playing without exposing controls */
  const backgroundVideos = document.querySelectorAll('video.back_video');
  const resumeBackgroundVideo = (video) => {
    video.muted = true;
    video.controls = false;
    video.play().catch(() => {});
  };
  backgroundVideos.forEach((video) => {
    video.addEventListener('pause', () => window.setTimeout(() => resumeBackgroundVideo(video), 0));
    video.addEventListener('ended', () => resumeBackgroundVideo(video));
    video.addEventListener('loadeddata', () => resumeBackgroundVideo(video));
    resumeBackgroundVideo(video);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) backgroundVideos.forEach(resumeBackgroundVideo);
  });

  /* Navbar links active state on scroll */
  let navbarlinks = select('#navbar .home-page-link', true)
  const navbarlinksActive = () => {
    let position = window.scrollY + 200
    navbarlinks.forEach(navbarlink => {
      if (!navbarlink.hash) return
      let section = select(navbarlink.hash)
      if (!section) return
      if (position >= section.offsetTop && position <= (section.offsetTop + section.offsetHeight)) {
        navbarlink.classList.add('active')
      } else {
        navbarlink.classList.remove('active')
      }
    })
  }
  window.addEventListener('load', navbarlinksActive)
  onscroll(document, navbarlinksActive)

  /* Navbar links active on click */

  const navLinkEls = document.querySelectorAll(".on-click");

  navLinkEls.forEach(navLinkEls => {
    navLinkEls.addEventListener('click', () => {
      document.querySelector('.active')?.classList.remove('active');
      navLinkEls.classList.add('active');
    });
  });

  /* Scrolls to an element with header offset */
  const scrollto = (el) => {
    let header = select('#header')
    let offset = header.offsetHeight

    let elementPos = select(el).offsetTop
    window.scrollTo({
      top: elementPos - offset,
      behavior: 'smooth'
    })
  }

  /* Toggle .header-scrolled class to #header when page is scrolled */
  let selectHeader = select('#header')
  if (selectHeader) {
    const headerScrolled = () => {
      if (window.scrollY > 100) {
        selectHeader.classList.add('header-scrolled')
      } else {
        selectHeader.classList.remove('header-scrolled')
      }
    }
    window.addEventListener('load', headerScrolled)
    onscroll(document, headerScrolled)
  }

  /* Back to top button */
  let backtotop = select('.back-to-top')
  if (backtotop) {
    const toggleBacktotop = () => {
      if (window.scrollY > 100) {
        backtotop.classList.add('active')
      } else {
        backtotop.classList.remove('active')
      }
    }
    window.addEventListener('load', toggleBacktotop)
    onscroll(document, toggleBacktotop)
  }

  /* Mobile nav toggle */
  on('click', '.mobile-nav-toggle', function(e) {
    select('#navbar').classList.toggle('navbar-mobile')
    this.classList.toggle('bi-list')
    this.classList.toggle('bi-x')
  })

  /* Mobile nav dropdowns activate */
  on('click', '.navbar .dropdown > a', function(e) {
    if (select('#navbar').classList.contains('navbar-mobile')) {
      e.preventDefault()
      this.nextElementSibling.classList.toggle('dropdown-active')
    }
  }, true)

  /*  Scroll with ofset on links with a class name .scrollto */
  on('click', '.scrollto', function(e) {
    if (select(this.hash)) {
      e.preventDefault()

      let navbar = select('#navbar')
      if (navbar.classList.contains('navbar-mobile')) {
        navbar.classList.remove('navbar-mobile')
        let navbarToggle = select('.mobile-nav-toggle')
        navbarToggle.classList.toggle('bi-list')
        navbarToggle.classList.toggle('bi-x')
      }
      scrollto(this.hash)
    }
  }, true)

  /* Scroll with ofset on page load with hash links in the url */
  window.addEventListener('load', () => {
    if (window.location.hash) {
      if (select(window.location.hash)) {
        scrollto(window.location.hash)
      }
    }
  });

  /* Preloader */
  let preloader = select('#preloader');
  if (preloader) {
    window.addEventListener('load', () => {
      preloader.remove()
    });
  }

  /* membership Slider */
  new Swiper('.membership-slider', {
    speed: 400,
    loop: true,
    autoplay: {
      delay: 5000,
      disableOnInteraction: false
    },
    slidesPerView: 'auto',
    pagination: {
      el: '.swiper-pagination',
      type: 'bullets',
      clickable: true
    },
    breakpoints: {
      320: {
        slidesPerView: 2,
        spaceBetween: 40
      },
      480: {
        slidesPerView: 3,
        spaceBetween: 60
      },
      640: {
        slidesPerView: 4,
        spaceBetween: 80
      },
      992: {
        slidesPerView: 6,
        spaceBetween: 120
      }
    }
  });

  /* Portfolio isotope and filter*/
  window.addEventListener('load', () => {
    let portfolioContainer = select('.portfolio-container');
    if (portfolioContainer) {
      let portfolioIsotope = new Isotope(portfolioContainer, {
        itemSelector: '.portfolio-item'
      });

      let portfolioFilters = select('#portfolio-flters li', true);

      on('click', '#portfolio-flters li', function(e) {
        e.preventDefault();
        portfolioFilters.forEach(function(el) {
          el.classList.remove('filter-active');
        });
        this.classList.add('filter-active');

        portfolioIsotope.arrange({
          filter: this.getAttribute('data-filter')
        });
        portfolioIsotope.on('arrangeComplete', function() {
          AOS.refresh()
        });
      }, true);
    }

  });

  /* Initiate portfolio lightbox */
  const portfolioLightbox = GLightbox({
    selector: '.portfolio-lightbox, .affiliate-lightbox'
  });

  /* BorderGlow-style directional edge light for portfolio cards. */
  const portfolioGlowCards = document.querySelectorAll('.portfolio .portfolio-wrap');
  if (window.matchMedia('(hover: hover)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    portfolioGlowCards.forEach((card, index) => {
      card.classList.add('portfolio-glow-sweep');
      card.style.setProperty('--portfolio-sweep-delay', `${index * 90}ms`);
      card.addEventListener('pointermove', (event) => {
        const bounds = card.getBoundingClientRect();
        const x = event.clientX - bounds.left - bounds.width / 2;
        const y = event.clientY - bounds.top - bounds.height / 2;
        const angle = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
        const edgeDistance = Math.min(event.clientX - bounds.left, bounds.right - event.clientX, event.clientY - bounds.top, bounds.bottom - event.clientY);
        const strength = Math.max(.48, Math.min(1, 1.18 - edgeDistance / 150));
        card.style.setProperty('--portfolio-glow-angle', `${angle}deg`);
        card.style.setProperty('--portfolio-glow-strength', strength.toFixed(2));
      });
      card.addEventListener('pointerleave', () => card.style.setProperty('--portfolio-glow-strength', '0'));
    });
  }

  /* Public partner gallery is sourced from the affiliate records in Supabase. */
  const publicAffiliateGrid = document.querySelector('[data-public-affiliate-grid]');
  if (publicAffiliateGrid) {
    fetch('/api/affiliates').then((response) => response.ok ? response.json() : null).then((data) => {
      if (!data || !Array.isArray(data.affiliates)) return;
      publicAffiliateGrid.replaceChildren();
      data.affiliates.forEach((affiliate) => {
        const card = document.createElement('article');
        card.className = 'affiliate-card palette-sand';
        const link = document.createElement('a');
        link.className = 'affiliate-image-link affiliate-lightbox';
        link.href = affiliate.logo_url;
        link.dataset.gallery = 'affiliateGallery';
        const art = document.createElement('div'); art.className = 'affiliate-art';
        const image = document.createElement('img'); image.src = affiliate.logo_url; image.alt = `${affiliate.company_name} logo`;
        const view = document.createElement('span'); view.innerHTML = 'View image <i class="bi bi-arrows-angle-expand"></i>';
        art.append(image, view); link.append(art);
        const copy = document.createElement('div'); copy.className = 'affiliate-copy';
        const label = document.createElement('span'); label.textContent = 'Affiliate partner';
        const title = document.createElement('h3'); title.textContent = affiliate.company_name;
        copy.append(label, title); card.append(link, copy); publicAffiliateGrid.append(card);
      });
      if (!data.affiliates.length) publicAffiliateGrid.innerHTML = '<p class="admin-empty">No affiliate partners are listed yet.</p>';
      document.querySelectorAll('[data-affiliate-total]').forEach((total) => { total.textContent = data.count; });
      portfolioLightbox.reload();
    }).catch(() => {});
  }

  /* Reveal key homepage content as it enters the viewport */
  const revealTargets = document.querySelectorAll(
    '.purpose-primary, .secondary-objectives, .history-timeline article, .family-grid article, .affiliate-card, .about .vision-and-mission > .row > .container'
  );
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('is-visible', entry.isIntersecting);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -30px' });
    revealTargets.forEach((target) => {
      target.classList.add('scroll-reveal');
      revealObserver.observe(target);
    });
  }

  /* Portfolio details slider */
  new Swiper('.portfolio-details-slider', {
    speed: 400,
    loop: true,
    autoplay: {
      delay: 5000,
      disableOnInteraction: false
    },
    pagination: {
      el: '.swiper-pagination',
      type: 'bullets',
      clickable: true
    }
  });

  /* Testimonials slider */
  new Swiper('.testimonials-slider', {
    speed: 600,
    loop: true,
    autoplay: {
      delay: 5000,
      disableOnInteraction: false
    },
    slidesPerView: 'auto',
    pagination: {
      el: '.swiper-pagination',
      type: 'bullets',
      clickable: true
    }
  });

  /* Animation on scroll */
  window.addEventListener('load', () => {
    AOS.init({
      duration: 1000,
      easing: "ease-in-out",
      once: false,
      mirror: true
    });
  });

  /* Initiate Pure Counter */
  new PureCounter();

  /* Cycle uploaded gallery images while a visitor hovers over them. */
  const initializeHoverGalleries = () => select('.hover-gallery', true).forEach((gallery) => {
    if (gallery.dataset.hoverGalleryReady) return;
    gallery.dataset.hoverGalleryReady = 'true';
    const images = Array.from(gallery.querySelectorAll('img'));
    if (images.length < 2) return;
    let current = 0;
    let timer;
    const show = (index) => images.forEach((image, imageIndex) => image.classList.toggle('is-active', imageIndex === index));
    show(0);
    gallery.addEventListener('mouseenter', () => {
      timer = window.setInterval(() => { current = (current + 1) % images.length; show(current); }, 1400);
    });
    gallery.addEventListener('mouseleave', () => { window.clearInterval(timer); current = 0; show(0); });
  });
  initializeHoverGalleries();
  window.bfimpcRefreshPortfolioUi = () => {
    portfolioLightbox.reload();
    initializeHoverGalleries();
    window.AOS?.refresh();
  };

  /* Preview the selected 2×2 Membership photo before the application is sent. */
  const membershipPhotoInput = document.querySelector('input[name="photo"]');
  membershipPhotoInput?.addEventListener('change', () => {
    const photo = membershipPhotoInput.files?.[0];
    const upload = membershipPhotoInput.closest('.membership-photo-upload');
    const preview = upload?.querySelector('.membership-photo-preview');
    const placeholder = upload?.querySelector('.membership-photo-placeholder');
    if (!upload || !preview || !placeholder) return;
    if (!photo) {
      preview.removeAttribute('src');
      preview.hidden = true;
      placeholder.hidden = false;
      upload.classList.remove('has-preview');
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      preview.src = String(reader.result);
      preview.hidden = false;
      placeholder.hidden = true;
      upload.classList.add('has-preview');
    }, { once: true });
    reader.readAsDataURL(photo);
  });

  /* Login and sign-up tabs */
  const accountPage = select('.account-page[data-auth-mode]');
  const authTabs = select('.auth-tab', true);
  authTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.authTab;
      if (!accountPage || !mode) return;
      accountPage.dataset.authMode = mode;
      authTabs.forEach((item) => item.classList.toggle('is-active', item === tab));
      window.history.replaceState({}, '', `/auth?mode=${mode}`);
    });
  });


})()
