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
      placeholderDate: "2026-yil 16-avgust",
      overviewTitle: "Umumiy ma’lumot",
      overviewBody:
        "VoltAI — O‘zbekistondagi elektromobil zaryadlash stansiyalari xaritasi va qayerda to‘xtab zaryadlashni hisoblab beradigan sayohat rejalashtiruvchisi. VoltAI’da foydalanuvchi hisoblari yo‘q va u sizdan hech qayerga kirishni so‘ramaydi. U shaxsiy ma’lumotlarni yig‘maydi, sotmaydi va ulashmaydi; unda analitika, reklama va kuzatuv yo‘q. Joylashuvingiz atrofingizdagi xaritani ko‘rsatish uchun faqat qurilmangizning o‘zida ishlatiladi. Ma’lumot telefoningizdan chiqadigan yagona holat — sayohatni rejalashtirish: siz tanlagan boshlanish va tugash nuqtalari hamda avtomobilingiz ko‘rsatkichlari marshrutni hisoblash uchun VoltAI serveriga yuboriladi — ism, hisob yoki qurilma identifikatorisiz. Siz sozlagan hamma narsa — sozlamalar, avtomobillar, saqlangan sayohatlar — telefoningizda qoladi. Ushbu siyosat VoltAI mobil ilovasi (Android va iOS, identifikator uz.voltai.app) va ushbu saytga taalluqli.",
      contactTitle: "Aloqa",
      contactBodyPrefix: "Savollar bo‘lsa, yozing:",
      privacy: {
        title: "Maxfiylik siyosati",
        description: "VoltAI ilovasi ma’lumotlar bilan nima qiladi va nima qilmaydi: hisoblar yo‘q, analitika yo‘q, joylashuv qurilmada ishlatiladi, sayohat rejalashtirish koordinatalarni serverimizga yuboradi.",
        infoCollectTitle: "Ilova qanday ma’lumotlardan foydalanadi",
        infoCollectIntro: "VoltAI faqat quyidagilardan va faqat ko‘rsatilgan maqsadda foydalanadi:",
        infoCollectBullets: [
          "Joylashuv (faqat ilova ochiq bo‘lganda). Ruxsatingiz bilan ilova siz undan faol foydalanayotganingizda («Foydalanish vaqtida») qurilma joylashuvini o‘qiydi — xaritani sizga markazlashtirish va eng yaqin zaryadlash joylarini ko‘rsatish uchun. U fonda joylashuvga murojaat qilmaydi, harakatingizni kuzatmaydi va xarita joylashuvingizni hech qachon VoltAI serverlariga yubormaydi. Ruxsatni bermasligingiz yoki istalgan vaqtda qurilma sozlamalarida bekor qilishingiz mumkin — xarita baribir ishlaydi, faqat o‘z joylashuvingizni ko‘rmaysiz.",
          "Xaritaning o‘zi. Xarita Yandex kompaniyasining Yandex MapKit komponenti bilan chiziladi. Har qanday onlayn xarita kabi u siz harakatlanganingizda xarita bo‘laklarini Yandex serverlaridan yuklaydi va «mening joylashuvim» qatlami yoqilganda ko‘k nuqtani chizish uchun qurilma joylashuvini qayta ishlaydi. Bu qayta ishlash Yandex komponenti tomonidan Yandex’ning o‘z shartlari va maxfiylik siyosati asosida bajariladi; VoltAI bu ma’lumotni olmaydi va saqlamaydi.",
          "Sayohatni rejalashtirish. Marshrut so‘raganingizda ilova VoltAI serveriga siz tanlagan boshlanish va manzil koordinatalarini (xaritada tanlangan joy, saqlangan manzil yoki «shu yerdan» tanlagan bo‘lsangiz — joriy joylashuvingiz) hamda reja tuzilayotgan avtomobil ko‘rsatkichlarini yuboradi: masofa zaxirasi, ulagich turi, maksimal zaryadlash tezligi, energiya sarfi, zaryadlash egri chizig‘i, boshlang‘ich zaryad darajasi, haydash uslubi va harorat tanlovi. Yo‘l geometriyasini olish uchun serverimiz faqat boshlanish va tugash koordinatalarini uchinchi tomon marshrut provayderi — MyTaxi’ga uzatadi. Bunda ism, e-mail, telefon raqami, hisob, reklama identifikatori yoki qurilma identifikatori yuborilmaydi; so‘rov anonim. Marshrut geometriyasi serverimizda cheklangan muddat keshlanadi va faqat koordinatalar hamda avtomobil ko‘rsatkichlariga bog‘lanadi.",
          "Sozlamalaringiz, avtomobillaringiz va saqlangan sayohatlaringiz. Tanlangan mavzu, garajdagi avtomobillar va tuzilgan sayohatlar faqat qurilmangizda saqlanadi. Ular hech qanday hisob yoki identifikatorga bog‘lanmagan va hech qayerga yuklanmaydi — faqat yuqorida aytilganidek, avtomobil ko‘rsatkichlari reja so‘roviga kiradi.",
          "Standart ulanish ma’lumotlari. Ilova stansiyalar, holatlar, marshrut yoki o‘z konfiguratsiyasini so‘raganda serverimiz (va uning oldidagi tarmoq tuguni) har qanday veb-so‘rovdagi oddiy texnik ma’lumotlarni, masalan IP-manzil va ilova versiyasini ko‘radi. Biz ulardan faqat so‘rovga xizmat ko‘rsatish va xizmatni ishlab turish uchun foydalanamiz; ular asosida profil tuzmaymiz.",
        ],
        useTitle: "Qanday foydalanamiz",
        useBullets: [
          "Atrofingizdagi xaritani va eng yaqin zaryadlash joylarini ko‘rsatish uchun (qurilmangizda).",
          "Sayohatni rejalashtirganingizda zaryadlash to‘xtashlari va marshrutni hisoblash uchun.",
          "So‘rovlarga xizmat ko‘rsatish va xizmatni ishlab turish uchun (standart ulanish ma’lumotlari).",
          "Boshqa hech narsa uchun. Hisoblar, ro‘yxatdan o‘tish, e-mail va telefon raqami yo‘q — biz kimligingizni so‘ramaganimiz uchun sizni aniqlay olmaymiz. VoltAI’da analitika SDK’lari, reklama, xatolar haqida hisobot xizmati, reklama identifikatorlari va ilovalararo kuzatuv yo‘q.",
        ],
        sharingTitle: "Ulashish va stansiya ma’lumotlari qayerdan olinadi",
        sharingIntro: "Biz hech kim haqidagi ma’lumotni sotmaymiz va ijaraga bermaymiz. Yagona ulashish holatlari:",
        sharingBullets: [
          "MyTaxi (marshrut provayderi) siz rejalashtirgan sayohatning boshlanish va tugash koordinatalarini oladi — boshqa hech narsani emas — yo‘l geometriyasini hisoblash uchun.",
          "Yandex (xarita provayderi) xarita va joylashuv ma’lumotlarini Yandex MapKit komponenti ichida o‘zining maxfiylik siyosati asosida qayta ishlaydi.",
          "VoltAI’da ko‘rsatiladigan stansiya ma’lumotlari (joylashuv, ulagichlar va quvvat, narxlar, real vaqtdagi bandlik) O‘zbekistondagi bir nechta zaryadlash operatorlarining ommaviy mobil ilovalaridan jamlanadi. Bu siz haqingizdagi emas, ommaviy infratuzilma haqidagi ma’lumot. VoltAI mustaqil ilova: u birorta operator bilan bog‘liq emas, ular tomonidan ma’qullanmagan va boshqarilmaydi; ma’lumotlar norasmiy — har bir necha daqiqada yangilanadi, lekin kechikishi, to‘liq bo‘lmasligi yoki ba’zan xato bo‘lishi mumkin. Har doim stansiyaning o‘zini tekshiring. Stansiya ma’lumotlari so‘rovlari shifrlangan ulanish (HTTPS) orqali yuboriladi va shaxsiy identifikatorlarni o‘z ichiga olmaydi.",
        ],
        retentionTitle: "Saqlash muddati va xavfsizlik",
        retentionBody: "Hisoblar va serverdagi foydalanuvchi yozuvlari bo‘lmagani uchun VoltAI siz haqingizda saqlaydigan yagona ma’lumotlar o‘z qurilmangizda turadi — ilova ma’lumotlarini tozalaguningizcha yoki ilovani o‘chirguningizcha (bunda sozlamalar, avtomobillar, saqlangan sayohatlar va stansiyalar ro‘yxatining oflayn nusxasi o‘chiriladi). Bizning tomonimizda o‘chiradigan shaxsiy ma’lumot yo‘q: reja so‘rovlari biror shaxsga bog‘lab saqlanmaydi, marshrut keshi esa faqat koordinatalar va avtomobil ko‘rsatkichlarini cheklangan muddat saqlaydi. Ilova va VoltAI xizmati o‘rtasidagi tarmoq almashinuvi standart shifrlangan ulanish (HTTPS/TLS) orqali amalga oshiriladi; foydalanuvchi hisoblari bo‘lmagani uchun sizib chiqishi mumkin bo‘lgan shaxsiy ma’lumotlar bazasi ham yo‘q.",
        choicesTitle: "Sizning tanlovlaringiz",
        choicesBullets: [
          "Joylashuv ruxsatini bermang yoki qurilma sozlamalarida bekor qiling — xarita baribir ishlaydi, faqat o‘z joylashuvingizni ko‘rmaysiz.",
          "Koordinatalar serverimizga yuborilishini istamasangiz, sayohat rejalashtiruvchisidan foydalanmang; xarita va stansiyalar ro‘yxati usiz ham ishlaydi.",
          "Qurilmada saqlangan hamma narsani o‘chirish uchun ilova ma’lumotlarini tozalang yoki ilovani o‘chiring.",
          "VoltAI keng haydovchilar auditoriyasi uchun mo‘ljallangan va bolalarga qaratilmagan; ilova hech kimdan, jumladan bolalardan, shaxsiy ma’lumotlarni bila turib yig‘maydi.",
          "Ilovadagi yoki qonunchilikdagi o‘zgarishlar tufayli biz ushbu siyosatni yangilashimiz mumkin. Bunda yuqoridagi kuchga kirish sanasi o‘zgaradi va yangi versiya shu manzilda e’lon qilinadi. Yangilanishdan keyin ilovadan foydalanishda davom etish yangi tahrirni qabul qilganingizni bildiradi.",
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
      placeholderDate: "16 августа 2026 г.",
      overviewTitle: "Обзор",
      overviewBody:
        "VoltAI — это карта зарядных станций для электромобилей в Узбекистане с планировщиком поездок, который подсказывает, где остановиться и зарядиться. В VoltAI нет учётных записей, и приложение не просит вас входить куда-либо. Оно не собирает, не продаёт и не передаёт персональные данные и не содержит аналитики, рекламы и трекинга. Ваша геолокация используется на самом устройстве, чтобы показать карту вокруг вас. Единственный случай, когда данные покидают ваш телефон, — планирование поездки: выбранные вами точки старта и финиша и параметры вашего автомобиля отправляются на сервер VoltAI для расчёта маршрута — без имени, аккаунта или идентификатора устройства. Всё, что вы настраиваете — предпочтения, автомобили, сохранённые поездки, — остаётся на вашем телефоне. Политика распространяется на мобильное приложение VoltAI (Android и iOS, идентификатор uz.voltai.app) и на этот сайт.",
      contactTitle: "Контакты",
      contactBodyPrefix: "По вопросам пишите:",
      privacy: {
        title: "Политика конфиденциальности",
        description: "Что приложение VoltAI делает и не делает с информацией: без учётных записей, без аналитики, геолокация используется на устройстве, планирование поездки отправляет координаты на наш сервер.",
        infoCollectTitle: "Какие данные использует приложение",
        infoCollectIntro: "VoltAI использует только перечисленное ниже и только для указанной цели:",
        infoCollectBullets: [
          "Геолокация (только на переднем плане). С вашего разрешения приложение читает местоположение устройства, пока вы им активно пользуетесь («При использовании»), чтобы центрировать карту на вас и показать ближайшие зарядки. Оно не обращается к геолокации в фоне, не отслеживает ваши перемещения, и карта никогда не отправляет вашу позицию на серверы VoltAI. Разрешение можно не давать или отозвать в любой момент в настройках устройства — карта продолжит работать, вы просто не увидите на ней свою позицию.",
          "Сама карта. Карта отрисовывается компонентом Yandex MapKit, разработанным Яндексом. Как любая онлайн-карта, он загружает тайлы с серверов Яндекса по мере перемещения и, когда включён слой «моё местоположение», обрабатывает геолокацию устройства, чтобы нарисовать синюю точку. Эта обработка выполняется компонентом Яндекса на его условиях и по его политике конфиденциальности; VoltAI эти данные не получает и не хранит.",
          "Планирование поездки. Когда вы запрашиваете маршрут, приложение отправляет на сервер VoltAI выбранные вами координаты старта и финиша (точка на карте, сохранённое место или ваша текущая позиция, если вы выбрали «отсюда») вместе с параметрами автомобиля, для которого строится план: запас хода, тип разъёма, максимальная скорость зарядки, расход энергии, профиль кривой зарядки, начальный уровень заряда, стиль вождения и температура. Чтобы получить геометрию дороги, наш сервер передаёт координаты старта и финиша — и только их — стороннему провайдеру маршрутизации MyTaxi. Ни имя, ни e-mail, ни номер телефона, ни аккаунт, ни рекламный идентификатор, ни идентификатор устройства при этом не передаются; запрос анонимен. Геометрия маршрута кэшируется на нашем сервере ограниченное время и привязана только к координатам и параметрам автомобиля.",
          "Ваши предпочтения, автомобили и сохранённые поездки. Выбранная тема, автомобили в гараже и построенные поездки хранятся только на вашем устройстве. Они не связаны ни с каким аккаунтом или идентификатором и никуда не выгружаются — за исключением того, что параметры автомобиля входят в запрос плана, как описано выше.",
          "Стандартные данные соединения. Когда приложение запрашивает станции, статусы, маршрут или свою конфигурацию, наш сервер (и сетевой узел перед ним) видит обычные технические сведения любого веб-запроса, например IP-адрес и версию приложения. Мы используем их только для обработки запроса и поддержания работы сервиса и не строим по ним профили.",
        ],
        useTitle: "Как мы используем данные",
        useBullets: [
          "Чтобы показать карту вокруг вас и ближайшие зарядки (на вашем устройстве).",
          "Чтобы рассчитать остановки для зарядки и маршрут, когда вы планируете поездку.",
          "Чтобы обрабатывать запросы и поддерживать работу сервиса (стандартные данные соединения).",
          "И ничего больше. Учётных записей, регистрации, e-mail и номера телефона нет — мы не можем вас идентифицировать, потому что не спрашиваем, кто вы. В VoltAI нет аналитических SDK, рекламы, сервисов отчётов о сбоях, рекламных идентификаторов и трекинга между приложениями.",
        ],
        sharingTitle: "Передача данных и источник данных о станциях",
        sharingIntro: "Мы никому не продаём и не сдаём в аренду информацию о ком-либо. Единственная передача, которая происходит:",
        sharingBullets: [
          "MyTaxi (провайдер маршрутизации) получает координаты старта и финиша планируемой поездки — и ничего больше — для расчёта геометрии дороги.",
          "Яндекс (провайдер карт) обрабатывает данные карты и геолокации внутри компонента Yandex MapKit по собственной политике конфиденциальности.",
          "Данные о станциях в VoltAI (расположение, разъёмы и мощность, цены, доступность в реальном времени) агрегируются из публичных мобильных приложений нескольких операторов зарядных станций Узбекистана. Это информация о публичной инфраструктуре, а не о вас. VoltAI — независимое приложение: оно не аффилировано ни с одним оператором, не одобрено ими и не управляется ими; данные неофициальные — они обновляются каждые несколько минут, но могут запаздывать, быть неполными или иногда ошибочными. Всегда проверяйте саму станцию. Запросы данных о станциях идут по шифрованному соединению (HTTPS) и не содержат персональных идентификаторов.",
        ],
        retentionTitle: "Хранение данных и безопасность",
        retentionBody: "Поскольку нет учётных записей и серверных записей о пользователях, единственные данные, которые VoltAI хранит о вас, находятся на вашем собственном устройстве — пока вы не очистите данные приложения или не удалите его (при этом удаляются предпочтения, автомобили, сохранённые поездки и офлайн-копия списка станций). На нашей стороне удалять нечего: запросы планов не сохраняются в привязке к человеку, а кэш маршрутов содержит только координаты и параметры автомобиля ограниченное время. Обмен между приложением и сервисом VoltAI идёт по стандартному шифрованному соединению (HTTPS/TLS); поскольку учётных записей нет, нет и базы персональных данных, которая могла бы утечь.",
        choicesTitle: "Ваш выбор",
        choicesBullets: [
          "Не давайте или отзовите разрешение на геолокацию в настройках устройства — карта продолжит работать, вы просто не увидите на ней свою позицию.",
          "Не пользуйтесь планировщиком поездок, если не хотите отправлять координаты на наш сервер; карта и список станций работают без него.",
          "Очистите данные приложения или удалите его, чтобы стереть всё, что хранится на устройстве.",
          "VoltAI предназначено для широкой аудитории водителей и не адресовано детям; приложение сознательно не собирает персональные данные ни у кого, включая детей.",
          "Мы можем обновлять эту политику при изменениях в приложении или в законодательстве. Тогда меняется дата вступления в силу выше, а новая версия публикуется по этому же адресу. Продолжая пользоваться приложением после обновления, вы принимаете новую редакцию.",
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
      placeholderDate: "16 August 2026",
      overviewTitle: "Overview",
      overviewBody:
        "VoltAI is a map of electric-vehicle (EV) charging stations in Uzbekistan, with a trip planner that works out where to stop and charge. VoltAI has no user accounts and asks you to sign in to nothing. It does not collect, sell or share personal information, and it contains no analytics, advertising or tracking. Your location is used on your device to show the map around you. The one time information leaves your phone is when you plan a trip: the start and end points you chose and your car’s figures are sent to VoltAI’s server to compute the route, with no name, account or device identifier attached. Everything you configure — preferences, cars, saved trips — stays on your phone. This policy applies to the VoltAI mobile app (Android and iOS, bundle identifier uz.voltai.app) and to this website.",
      contactTitle: "Contact",
      contactBodyPrefix: "Questions? Email:",
      privacy: {
        title: "Privacy Policy",
        description: "What the VoltAI app does and does not do with information: no accounts, no analytics, location used on-device, trip planning sends coordinates to our server.",
        infoCollectTitle: "Information the app uses",
        infoCollectIntro: "VoltAI uses only the following information, and only for the purpose described:",
        infoCollectBullets: [
          "Location (foreground only). With your permission, the app reads your device’s location while you are actively using it (“When In Use”), to centre the map on you and show the nearest chargers. It does not access your location in the background, does not track your movements, and the map never sends your position to VoltAI’s servers. You can decline or revoke the permission at any time in your device settings; the map still works, you just will not see your own position on it.",
          "The map itself. The map is drawn by Yandex MapKit, a mapping component made by Yandex. Like any online map it fetches map tiles from Yandex’s servers as you move around and, when the “my location” layer is on, it processes your device location to draw the blue dot. That processing is done by the Yandex component under Yandex’s own terms and privacy policy; VoltAI does not receive or store it.",
          "Trip planning. When you ask for a route, the app sends to VoltAI’s server the start and destination coordinates you selected (a place you picked on the map, a saved destination, or your current position if you chose “from here”), together with the figures of the car you are planning with: its range, connector type, maximum charging speed, energy consumption, charging-curve preset, starting charge level, and your driving-style and temperature choices. To obtain the road geometry our server forwards the start and end coordinates — only those — to a third-party routing provider, MyTaxi. No name, email, phone number, account, advertising ID or device identifier accompanies any of this; the request is anonymous. Route geometry is cached on our server for a limited time, keyed by the coordinates and car figures only.",
          "Your preferences, cars and saved trips. The theme you choose, the cars in your garage and the trips you have planned are saved only on your device. They are not associated with any account or identifier and are never uploaded — except that, as described above, a car’s figures are included in a plan request when you plan a trip with it.",
          "Standard connection data. When the app requests station data, statuses, a route or its configuration, our server (and the network edge in front of it) sees the ordinary technical details any web request carries, such as your IP address and the app’s version. We use this only to serve the request and keep the service running; we do not build profiles from it.",
        ],
        useTitle: "How we use information",
        useBullets: [
          "To show the map around you and the nearest chargers (on your device).",
          "To compute charging stops and a route when you plan a trip.",
          "To serve requests and keep the service running (standard connection data).",
          "Nothing else. There are no accounts, no registration, no email or phone number — we cannot identify you because we never ask who you are. VoltAI includes no analytics SDKs, no advertising, no crash-reporting service, no advertising identifiers and no cross-app tracking or profiling.",
        ],
        sharingTitle: "Sharing, and where the station data comes from",
        sharingIntro: "We do not sell or rent information about anyone. The only sharing that happens:",
        sharingBullets: [
          "MyTaxi, the routing provider, receives the start and end coordinates of a trip you plan — nothing else — so the road geometry can be computed.",
          "Yandex, the map provider, processes map and location data inside the Yandex MapKit component under Yandex’s own privacy policy.",
          "The charging-station locations, connector and power details, prices and live availability shown in VoltAI are aggregated from the public mobile apps of several EV charging operators active in Uzbekistan. This is information about public charging infrastructure, not about you. VoltAI is an independent app: it is not affiliated with, endorsed by or operated by any charging operator, and the data is unofficial — refreshed every few minutes but possibly delayed, incomplete or occasionally wrong. Always check the charger itself before relying on it. Requests for station data are made over an encrypted (HTTPS) connection and carry no personal identifiers.",
        ],
        retentionTitle: "Storage, retention and security",
        retentionBody: "Because there are no accounts and no server-side user records, the only data VoltAI retains about you lives on your own device, until you clear the app’s data or uninstall the app — which deletes all locally stored preferences, cars, saved trips and the offline copy of the station list. On our side there is no personal data to delete: plan requests are not stored against any person, and the route cache holds only coordinates and car figures for a limited time. Network requests between the app and VoltAI’s service use standard encrypted transport (HTTPS/TLS); since there are no user accounts, there is no personal database that could be exposed in a breach.",
        choicesTitle: "Your choices",
        choicesBullets: [
          "Decline or revoke the location permission in your device settings — the map still works, you just will not see your own position.",
          "Do not use the trip planner if you do not want coordinates sent to our server; the map and station list work without it.",
          "Clear the app’s data or uninstall the app to remove everything stored on your device.",
          "VoltAI is intended for a general audience of drivers and is not directed to children; the app does not knowingly collect personal information from anyone, including children.",
          "We may update this policy to reflect changes in the app or in legal requirements. When we do, we revise the effective date above and post the updated version at this same address. Continued use of the app after an update means you accept the revised policy.",
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

