const dictionary = {
  ar: {
    appName: "يُسر",
    save: "حفظ",
    cancel: "إلغاء"
  },
  en: {
    appName: "Yusr",
    save: "Save",
    cancel: "Cancel"
  }
};

let activeLanguage = "ar";

export const i18n = {
  setLanguage(language) {
    activeLanguage = dictionary[language] ? language : "ar";
    document.documentElement.lang = activeLanguage;
    document.documentElement.dir = activeLanguage === "ar" ? "rtl" : "ltr";
  },
  t(key) {
    return dictionary[activeLanguage][key] || dictionary.ar[key] || key;
  }
};
