window.CARD_STUDIO_CONFIG = Object.freeze({
  payloadPrefix: "ABDO_SMART_CARD_PAYLOAD_",
  sections: [
    { id: "debt", label: "قسم ديون العملاء" },
    { id: "companies", label: "قسم الشركات والتجار" },
    { id: "trust", label: "قسم الأمانات" },
    { id: "zero", label: "تصفير الحساب" },
    { id: "masraweya", label: "قسم المصراوية" },
    { id: "purchases", label: "قسم المشتريات" },
    { id: "alert", label: "إشعار تنبيه 📢" },
    { id: "exchange_rate", label: "أسعار صرف" },
    { id: "mini_card", label: "كروت صغيرة 🎫" },
  ],
  generatedThemes: [
    {
      id: "bg-pyramids-3d",
      label: "الأهرامات ثلاثية الأبعاد",
      asset: "/card-studio/assets/pyramids-3d.png",
    },
    {
      id: "bg-libya-heritage-3d",
      label: "الآثار الليبية ثلاثية الأبعاد",
      asset: "/card-studio/assets/libya-heritage-3d.png",
    },
    {
      id: "bg-nature-light",
      label: "الطبيعة الفاتحة",
      asset: "/card-studio/assets/nature-light.png",
    },
  ],
  layouts: [{ id: "layout-unified", label: "الكارت الموحد" }],
});
