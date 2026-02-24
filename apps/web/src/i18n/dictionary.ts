import type { Locale } from "@/i18n/config";

export type Dictionary = {
  nav: {
    privacy: string;
    terms: string;
  };
  languageShort: Record<Locale, string>;
  hero: {
    badge: string;
    title: string;
    subtitle: string;
    ctaGooglePlay: string;
    ctaAppStore: string;
    comingSoon: string;
    needHelp: string;
  };
  quickCards: {
    searchTitle: string;
    searchBody: string;
    filterTitle: string;
    filterBody: string;
    navigateTitle: string;
    navigateBody: string;
    saveTitle: string;
    saveBody: string;
  };
  sections: {
    whyTitle: string;
    whySubtitle: string;
    screenshotsTitle: string;
    screenshotsSubtitle: string;
    faqTitle: string;
  };
  screenshotLabels: {
    search: string;
    details: string;
    filters: string;
  };
  features: Array<{ title: string; body: string }>;
  faq: Array<{ q: string; a: string }>;
  footer: {
    supportLabel: string;
    privacyPolicy: string;
    termsOfService: string;
  };
  legal: {
    effectiveDateLabel: string;
    placeholderDate: string;
    overviewTitle: string;
    overviewBody: string;
    contactTitle: string;
    contactBodyPrefix: string;
    privacy: {
      title: string;
      description: string;
      infoCollectTitle: string;
      infoCollectIntro: string;
      infoCollectBullets: string[];
      useTitle: string;
      useBullets: string[];
      sharingTitle: string;
      sharingIntro: string;
      sharingBullets: string[];
      retentionTitle: string;
      retentionBody: string;
      choicesTitle: string;
      choicesBullets: string[];
    };
    terms: {
      title: string;
      description: string;
      agreementTitle: string;
      agreementBody: string;
      providesTitle: string;
      providesBody: string;
      responsibilitiesTitle: string;
      responsibilitiesBullets: string[];
      thirdPartyTitle: string;
      thirdPartyBody: string;
      disclaimersTitle: string;
      disclaimersBody: string;
      liabilityTitle: string;
      liabilityBody: string;
      changesTitle: string;
      changesBody: string;
    };
  };
};

const common = {
  languageShort: {
    uz: "UZ",
    ru: "RU",
    en: "EN",
  } as const,
};

export const dictionaries: Record<Locale, Dictionary> = {
  uz: {
    nav: { privacy: "Maxfiylik", terms: "Shartlar" },
    languageShort: common.languageShort,
    hero: {
      badge: "EV zaryadlash punktlari — bitta joyda",
      title: "VoltAI EV zaryadlovchilarni tez topishga yordam beradi.",
      subtitle:
        "Zaryadlash stansiyalarini toping, taqqoslang va yo‘l-yo‘riq oling — tungi haydash uchun qulay, dark-first dizayn.",
      ctaGooglePlay: "Google Play’dan yuklab olish",
      ctaAppStore: "App Store’dan yuklab olish",
      comingSoon: "(tez kunda)",
      needHelp: "Yordam kerakmi?",
    },
    quickCards: {
      searchTitle: "Qidirish",
      searchBody: "Yaqin atrofda va marshrut bo‘ylab stansiyalarni toping.",
      filterTitle: "Filtr",
      filterBody: "Konnektor, quvvat va mavjudlik bo‘yicha saralang.",
      navigateTitle: "Navigatsiya",
      navigateBody: "Yo‘nalishni xarita ilovangizda oching.",
      saveTitle: "Saqlash",
      saveBody: "Sevimlilarni saqlab, keyin tez toping.",
    },
    sections: {
      whyTitle: "Nega VoltAI",
      whySubtitle: "Oddiy, tez va real hayotdagi zaryadlash jarayoni uchun.",
      screenshotsTitle: "Skrinshotlar",
      screenshotsSubtitle:
        "Hozircha maket. Keyin istalgan payt haqiqiy rasmlarni qo‘shasiz.",
      faqTitle: "Savol-javob",
    },
    screenshotLabels: {
      search: "Qidiruv",
      details: "Stansiya tafsilotlari",
      filters: "Filtrlar",
    },
    features: [
      {
        title: "Tez toping",
        body: "Yaqin stansiyalarni va yo‘l bo‘yidagi variantlarni ko‘ring.",
      },
      {
        title: "Aqlli filtrlar",
        body: "Konnektor turi, quvvat, mavjudlik va qulayliklar bo‘yicha.",
      },
      { title: "Sevimlilar", body: "Ishonchli stansiyalarni belgilab qo‘ying." },
      {
        title: "Ishonchli yo‘nalish",
        body: "Tanlagan xarita ilovangizda navigatsiyani oching.",
      },
      {
        title: "Kengayib boradi",
        body: "VoltAI ko‘proq zaryadlash imkoniyatlarini topishni osonlashtiradi.",
      },
      {
        title: "Dark-first dizayn",
        body: "Tungi haydashda ko‘rishga qulay, toza interfeys.",
      },
    ],
    faq: [
      {
        q: "VoltAI bepulmi?",
        a: "Ba’zi funksiyalar bepul bo‘lishi mumkin. Narxlar bo‘lsa, ilova ichida ko‘rsatiladi.",
      },
      {
        q: "VoltAI barcha stansiyalarni ko‘rsatadimi?",
        a: "Maqsad — iloji boricha ko‘proq EV zaryadlash joylarini ko‘rsatish va bazani kengaytirish.",
      },
      {
        q: "Noto‘g‘ri ma’lumotni qanday bildirsam bo‘ladi?",
        a: "Stansiya nomi/manzili va nimani tuzatish kerakligini yuboring.",
      },
      {
        q: "Joylashuvim kuzatiladimi?",
        a: "Yaqin stansiyalarni ko‘rsatish uchun joylashuvdan foydalanilishi mumkin. Batafsil — Maxfiylik siyosatida.",
      },
      {
        q: "Ilova qachon chiqadi?",
        a: "Tez orada. Store havolalari tayyor bo‘lganda tugmalar aktiv bo‘ladi.",
      },
    ],
    footer: {
      supportLabel: "Yordam",
      privacyPolicy: "Maxfiylik siyosati",
      termsOfService: "Foydalanish shartlari",
    },
    legal: {
      effectiveDateLabel: "Kuchga kirish sanasi",
      placeholderDate: "[sana kiriting]",
      overviewTitle: "Umumiy ma’lumot",
      overviewBody:
        "Ushbu matn shablon. Braket ichidagi joylarni o‘zingizning yakuniy ma’lumotlaringiz bilan to‘ldiring.",
      contactTitle: "Aloqa",
      contactBodyPrefix: "Savollar bo‘lsa, yozing:",
      privacy: {
        title: "Maxfiylik siyosati",
        description: "VoltAI ma’lumotlarni qanday yig‘adi va ishlatadi.",
        infoCollectTitle: "Yig‘iladigan ma’lumotlar",
        infoCollectIntro:
          "Xizmatlardan foydalanishingizga qarab quyidagilar yig‘ilishi mumkin:",
        infoCollectBullets: [
          "Foydalanish ma’lumotlari (ekranlar, funksiyalar bilan o‘zaro aloqa).",
          "Qurilma ma’lumotlari (model, OS, ilova versiyasi).",
          "Joylashuv (ruxsat bersangiz) — yaqin stansiyalarni ko‘rsatish uchun.",
          "Qo‘llab-quvvatlash xabarlari (supportga yozganingiz).",
        ],
        useTitle: "Qanday foydalanamiz",
        useBullets: [
          "Xizmatni taqdim etish va yaxshilash (qidiruv, filtr, navigatsiya).",
          "Xatolarni aniqlash va xavfsizlikni ta’minlash.",
          "Murojaatlaringizga javob berish.",
        ],
        sharingTitle: "Ulashish",
        sharingIntro:
          "Biz shaxsiy ma’lumotlaringizni sotmaymiz. Ayrim hollarda quyidagilar bilan ulashishimiz mumkin:",
        sharingBullets: [
          "Xosting/analitika kabi xizmat ko‘rsatuvchilar bilan (shartnomalar asosida).",
          "Qonun talab qilsa yoki xavfsizlik uchun zarur bo‘lsa.",
        ],
        retentionTitle: "Saqlash muddati",
        retentionBody:
          "Ma’lumotlar faqat ushbu siyosatda ko‘rsatilgan maqsadlar uchun zarur muddat saqlanadi.",
        choicesTitle: "Sizning tanlovlaringiz",
        choicesBullets: [
          "Joylashuv ruxsatini qurilmangiz sozlamalaridan o‘chirishingiz mumkin.",
          "Kerak bo‘lsa, yangilash/o‘chirish bo‘yicha supportga yozing.",
        ],
      },
      terms: {
        title: "Foydalanish shartlari",
        description: "VoltAI’dan foydalanish qoidalari va shartlari.",
        agreementTitle: "Kelishuv",
        agreementBody:
          "Xizmatlardan foydalansangiz, ushbu shartlarga rozilik bildirasiz. Rozilik bo‘lmasa, foydalanmang.",
        providesTitle: "VoltAI nimani taqdim etadi",
        providesBody:
          "VoltAI EV zaryadlash stansiyalarini topishga yordam beradi. Agar alohida ko‘rsatilmagan bo‘lsa, biz stansiyalarni boshqarmaymiz.",
        responsibilitiesTitle: "Foydalanuvchi majburiyatlari",
        responsibilitiesBullets: [
          "Xizmatlardan qonuniy va hurmat bilan foydalaning.",
          "Ma’lumotlarni real hayotda tekshiring (mavjudlik, narx, moslik).",
          "Xizmatni buzish yoki suiiste’mol qilishga urinmang.",
        ],
        thirdPartyTitle: "Uchinchi tomon xizmatlari",
        thirdPartyBody:
          "Xizmatlar uchinchi tomon havolalarini o‘z ichiga olishi mumkin (masalan, xaritalar). Ularning siyosati uchun javobgar emasmiz.",
        disclaimersTitle: "Rad etish",
        disclaimersBody:
          "Xizmatlar “mavjud holatda” taqdim etiladi. Stansiya ma’lumotlari o‘zgarishi mumkin va to‘liq bo‘lmasligi ehtimol.",
        liabilityTitle: "Javobgarlik cheklovi",
        liabilityBody:
          "Qonun ruxsat bergan darajada, bilvosita yoki oqibatli zararlar uchun javobgar emasmiz.",
        changesTitle: "O‘zgarishlar",
        changesBody:
          "Shartlar vaqti-vaqti bilan yangilanishi mumkin. Muhim o‘zgarish bo‘lsa, xabar beramiz.",
      },
    },
  },
  ru: {
    nav: { privacy: "Конфиденциальность", terms: "Условия" },
    languageShort: common.languageShort,
    hero: {
      badge: "EV-зарядки — в одном месте",
      title: "VoltAI помогает быстро находить EV-зарядки.",
      subtitle:
        "Находите станции, сравнивайте варианты и стройте маршрут — тёмный интерфейс для удобства в дороге.",
      ctaGooglePlay: "Скачать в Google Play",
      ctaAppStore: "Скачать в App Store",
      comingSoon: "(скоро)",
      needHelp: "Нужна помощь?",
    },
    quickCards: {
      searchTitle: "Поиск",
      searchBody: "Станции рядом и по маршруту.",
      filterTitle: "Фильтры",
      filterBody: "Разъём, мощность, доступность.",
      navigateTitle: "Навигация",
      navigateBody: "Откройте маршрут в картах.",
      saveTitle: "Избранное",
      saveBody: "Сохраняйте любимые станции.",
    },
    sections: {
      whyTitle: "Почему VoltAI",
      whySubtitle: "Просто, быстро и для реальных сценариев зарядки.",
      screenshotsTitle: "Скриншоты",
      screenshotsSubtitle:
        "Пока заглушки — позже замените на реальные изображения.",
      faqTitle: "FAQ",
    },
    screenshotLabels: {
      search: "Поиск",
      details: "Детали станции",
      filters: "Фильтры",
    },
    features: [
      { title: "Быстрый поиск", body: "Станции рядом и по маршруту." },
      { title: "Умные фильтры", body: "Тип разъёма, мощность, доступность." },
      { title: "Избранное", body: "Сохраняйте проверенные точки зарядки." },
      { title: "Навигация", body: "Открывайте маршрут в любимых картах." },
      {
        title: "База растёт",
        body: "Мы расширяем покрытие и добавляем новые точки.",
      },
      { title: "Тёмная тема", body: "Читабельно и комфортно ночью." },
    ],
    faq: [
      {
        q: "VoltAI бесплатный?",
        a: "Часть функций может быть бесплатной. Если будет цена — покажем в приложении.",
      },
      {
        q: "Показывает ли VoltAI все станции?",
        a: "Цель — показать максимум актуальных точек и расширять базу со временем.",
      },
      {
        q: "Как сообщить об ошибке в станции?",
        a: "Напишите нам название/локацию и что нужно исправить.",
      },
      {
        q: "Используется ли геолокация?",
        a: "Геолокация может использоваться для показа ближайших станций. Подробности — в Политике конфиденциальности.",
      },
      {
        q: "Когда приложение будет доступно?",
        a: "Скоро. Кнопки станут активными, когда появятся ссылки магазинов.",
      },
    ],
    footer: {
      supportLabel: "Поддержка",
      privacyPolicy: "Политика конфиденциальности",
      termsOfService: "Пользовательское соглашение",
    },
    legal: {
      effectiveDateLabel: "Дата вступления в силу",
      placeholderDate: "[укажите дату]",
      overviewTitle: "Обзор",
      overviewBody:
        "Это шаблон. Замените поля в квадратных скобках на ваши финальные данные.",
      contactTitle: "Контакты",
      contactBodyPrefix: "По вопросам пишите:",
      privacy: {
        title: "Политика конфиденциальности",
        description: "Как VoltAI собирает и использует информацию.",
        infoCollectTitle: "Какие данные мы собираем",
        infoCollectIntro: "В зависимости от использования мы можем собирать:",
        infoCollectBullets: [
          "Данные использования (экраны, действия в приложении).",
          "Данные устройства (модель, ОС, версия приложения).",
          "Геолокация (если разрешите) — чтобы показывать станции рядом.",
          "Обращения в поддержку (содержимое сообщений).",
        ],
        useTitle: "Как мы используем данные",
        useBullets: [
          "Предоставление и улучшение сервиса.",
          "Диагностика ошибок и безопасность.",
          "Ответы на запросы и поддержку.",
        ],
        sharingTitle: "Передача третьим лицам",
        sharingIntro:
          "Мы не продаём персональные данные. Возможна передача:",
        sharingBullets: [
          "Провайдерам (хостинг/аналитика) по договорам.",
          "По требованию закона или для защиты безопасности.",
        ],
        retentionTitle: "Хранение",
        retentionBody:
          "Храним данные столько, сколько необходимо для целей, указанных в политике.",
        choicesTitle: "Ваши выборы",
        choicesBullets: [
          "Можно отключить доступ к геолокации в настройках устройства.",
          "Можно обратиться по вопросам обновления/удаления данных.",
        ],
      },
      terms: {
        title: "Условия использования",
        description: "Правила и условия использования VoltAI.",
        agreementTitle: "Согласие",
        agreementBody:
          "Используя сервис, вы соглашаетесь с условиями. Если не согласны — не используйте сервис.",
        providesTitle: "Что делает VoltAI",
        providesBody:
          "VoltAI помогает находить EV-станции. Мы не владеем и не управляем станциями, если не указано иное.",
        responsibilitiesTitle: "Обязанности пользователя",
        responsibilitiesBullets: [
          "Используйте сервис законно.",
          "Проверяйте данные на месте (наличие, цена, совместимость).",
          "Не пытайтесь нарушать работу или злоупотреблять сервисом.",
        ],
        thirdPartyTitle: "Сторонние сервисы",
        thirdPartyBody:
          "Могут быть ссылки на сторонние сервисы (карты). Мы не отвечаем за их контент и политики.",
        disclaimersTitle: "Отказ от гарантий",
        disclaimersBody:
          "Сервис предоставляется «как есть». Данные о станциях могут быть неполными или неточными.",
        liabilityTitle: "Ограничение ответственности",
        liabilityBody:
          "В максимально допустимой мере мы не несем ответственности за косвенный ущерб.",
        changesTitle: "Изменения",
        changesBody:
          "Мы можем обновлять условия. При существенных изменениях обновим дату и/или уведомим в сервисе.",
      },
    },
  },
  en: {
    nav: { privacy: "Privacy", terms: "Terms" },
    languageShort: common.languageShort,
    hero: {
      badge: "EV charging stations, in one place",
      title: "VoltAI helps you find EV chargers quickly.",
      subtitle:
        "Discover charging stations, compare options, and get directions — with a dark-first interface designed for clarity on the road.",
      ctaGooglePlay: "Get it on Google Play",
      ctaAppStore: "Download on the App Store",
      comingSoon: "(coming soon)",
      needHelp: "Need help?",
    },
    quickCards: {
      searchTitle: "Search",
      searchBody: "Find stations nearby and along your route.",
      filterTitle: "Filter",
      filterBody: "Connector, power, and availability.",
      navigateTitle: "Navigate",
      navigateBody: "Open directions in your maps app.",
      saveTitle: "Save",
      saveBody: "Keep favorites for quick access.",
    },
    sections: {
      whyTitle: "Why VoltAI",
      whySubtitle: "Simple, fast, and built for real-world charging workflows.",
      screenshotsTitle: "Screenshots",
      screenshotsSubtitle:
        "Placeholder frames for now — drop in real app images anytime.",
      faqTitle: "FAQ",
    },
    screenshotLabels: { search: "Search", details: "Station details", filters: "Filters" },
    features: [
      {
        title: "Find stations fast",
        body: "Search charging points nearby and along your route, with clear station details.",
      },
      {
        title: "Smart filters",
        body: "Filter by connector type, power, availability, and amenities to match your needs.",
      },
      { title: "Save favorites", body: "Bookmark reliable stations for quick access next time." },
      { title: "Navigate with confidence", body: "Open directions in your preferred maps app and get there quickly." },
      { title: "Coverage that grows", body: "VoltAI focuses on making it easy to discover more charging options over time." },
      { title: "Dark-first design", body: "A clean interface optimized for night driving and quick readability." },
    ],
    faq: [
      { q: "Is VoltAI free?", a: "The app may include free features; pricing details will be shared in-app when available." },
      { q: "Does VoltAI show all charging stations?", a: "VoltAI aims to list as many relevant EV charging locations as possible and expand coverage over time." },
      { q: "How do I report an incorrect station?", a: "Email us with the station name/location and what needs updating." },
      { q: "Do you track my location?", a: "Location may be used to show nearby stations. Details will be described in the Privacy Policy." },
      { q: "When will the app be available?", a: "Soon. The download buttons will become active once store listings are ready." },
    ],
    footer: {
      supportLabel: "Support",
      privacyPolicy: "Privacy Policy",
      termsOfService: "Terms of Service",
    },
    legal: {
      effectiveDateLabel: "Effective date",
      placeholderDate: "[add date]",
      overviewTitle: "Overview",
      overviewBody:
        "This is a template. Replace bracketed placeholders with your final details before publishing.",
      contactTitle: "Contact",
      contactBodyPrefix: "Questions? Email:",
      privacy: {
        title: "Privacy Policy",
        description: "How VoltAI collects and uses information.",
        infoCollectTitle: "Information we collect",
        infoCollectIntro:
          "Depending on how you use the Services, we may collect:",
        infoCollectBullets: [
          "Usage data (screens viewed, feature interactions).",
          "Device data (model, OS, app version).",
          "Location (if enabled) to show nearby stations.",
          "Support communications (messages you send us).",
        ],
        useTitle: "How we use information",
        useBullets: [
          "Provide and improve the Services.",
          "Diagnose bugs and keep the Services secure.",
          "Respond to support requests.",
        ],
        sharingTitle: "Sharing",
        sharingIntro:
          "We do not sell personal information. We may share with:",
        sharingBullets: [
          "Service providers (hosting/analytics) under appropriate agreements.",
          "Authorities when required by law or to protect safety and security.",
        ],
        retentionTitle: "Data retention",
        retentionBody:
          "We keep information only as long as needed for the purposes described, unless required by law.",
        choicesTitle: "Your choices",
        choicesBullets: [
          "Disable location access in device settings.",
          "Contact us for update/deletion requests where applicable.",
        ],
      },
      terms: {
        title: "Terms of Service",
        description: "Rules and conditions for using VoltAI.",
        agreementTitle: "Agreement",
        agreementBody:
          "By using the Services, you agree to these Terms. If you do not agree, do not use the Services.",
        providesTitle: "What VoltAI provides",
        providesBody:
          "VoltAI helps you discover EV charging stations and related information. We do not own or operate stations unless stated.",
        responsibilitiesTitle: "User responsibilities",
        responsibilitiesBullets: [
          "Use the Services lawfully.",
          "Verify station details in real life (availability, pricing, compatibility).",
          "Do not disrupt or abuse the Services.",
        ],
        thirdPartyTitle: "Third-party services",
        thirdPartyBody:
          "The Services may link to third-party services (e.g. mapping). We are not responsible for third-party policies or availability.",
        disclaimersTitle: "Disclaimers",
        disclaimersBody:
          "The Services are provided on an “as is” and “as available” basis. Station data can change and may be incomplete or inaccurate.",
        liabilityTitle: "Limitation of liability",
        liabilityBody:
          "To the fullest extent permitted by law, VoltAI will not be liable for indirect or consequential damages.",
        changesTitle: "Changes",
        changesBody:
          "We may update these Terms from time to time. We will update the effective date and/or provide notice within the Services.",
      },
    },
  },
};

