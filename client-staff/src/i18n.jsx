import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const dict = {
  en: {
    appName: 'Engineering Checklist',
    hotel: 'The SmallVille Hotel',
    username: 'Username',
    password: 'Password',
    signIn: 'Sign in',
    signOut: 'Sign out',
    signingIn: 'Signing in…',
    wrongLogin: 'Wrong username or password',
    chooseOutlet: 'Choose an location',
    yourShift: 'Your shift',
    businessDate: 'Shift date',
    unscheduled: 'Not on the roster — recorded as unscheduled',
    tasks: 'tasks',
    done: 'done',
    notStarted: 'Not started',
    inProgress: 'In progress',
    completed: 'Completed',
    issues: 'issues',
    back: 'Back',
    yes: 'Yes',
    no: 'No',
    comment: 'Comment',
    addComment: 'Add a comment (optional)',
    commentRequired: 'Write what is wrong before saving',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    cancel: 'Cancel',
    clear: 'Clear answer',
    photo: 'Photo',
    addPhoto: 'Add photo',
    uploading: 'Uploading…',
    critical: 'Critical',
    doneEarlier: 'Already done this period',
    doneBy: 'by',
    at: 'at',
    completeRound: 'Submit round',
    completing: 'Submitting…',
    roundComplete: 'Round submitted',
    reopen: 'Reopen',
    edited: 'edited',
    progress: 'Progress',
    allDone: 'All tasks answered',
    remaining: 'remaining',
    retry: 'Retry',
    loading: 'Loading…',
    changePassword: 'Set a new password',
    changePasswordHint: 'You must choose your own password before continuing.',
    currentPassword: 'Current password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    passwordsDontMatch: 'The two passwords are not the same',
    update: 'Update',
    every_shift: 'Every shift',
    daily: 'Once a day',
    weekly: 'Once a week',
    noTasks: 'No tasks have been set up for this location yet.',
    offline: 'You are offline. Changes cannot be saved right now.',
  },
  ar: {
    appName: 'قائمة فحص الصيانة',
    hotel: 'فندق سمولفيل',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    signIn: 'تسجيل الدخول',
    signOut: 'تسجيل الخروج',
    signingIn: 'جاري الدخول…',
    wrongLogin: 'اسم المستخدم أو كلمة المرور غير صحيحة',
    chooseOutlet: 'اختر الموقع',
    yourShift: 'دوامك',
    businessDate: 'تاريخ الدوام',
    unscheduled: 'غير مجدول — سيتم تسجيله كدوام غير مجدول',
    tasks: 'مهمة',
    done: 'منجزة',
    notStarted: 'لم يبدأ',
    inProgress: 'قيد التنفيذ',
    completed: 'مكتمل',
    issues: 'ملاحظات',
    back: 'رجوع',
    yes: 'نعم',
    no: 'لا',
    comment: 'ملاحظة',
    addComment: 'أضف ملاحظة (اختياري)',
    commentRequired: 'اكتب ما هي المشكلة قبل الحفظ',
    save: 'حفظ',
    saving: 'جاري الحفظ…',
    saved: 'تم الحفظ',
    cancel: 'إلغاء',
    clear: 'مسح الإجابة',
    photo: 'صورة',
    addPhoto: 'إضافة صورة',
    uploading: 'جاري الرفع…',
    critical: 'حرج',
    doneEarlier: 'تم إنجازها في هذه الفترة',
    doneBy: 'بواسطة',
    at: 'الساعة',
    completeRound: 'إرسال الجولة',
    completing: 'جاري الإرسال…',
    roundComplete: 'تم إرسال الجولة',
    reopen: 'إعادة فتح',
    edited: 'معدّلة',
    progress: 'التقدم',
    allDone: 'تمت الإجابة على كل المهام',
    remaining: 'متبقية',
    retry: 'إعادة المحاولة',
    loading: 'جاري التحميل…',
    changePassword: 'اختر كلمة مرور جديدة',
    changePasswordHint: 'يجب اختيار كلمة مرور خاصة بك قبل المتابعة.',
    currentPassword: 'كلمة المرور الحالية',
    newPassword: 'كلمة المرور الجديدة',
    confirmPassword: 'تأكيد كلمة المرور',
    passwordsDontMatch: 'كلمتا المرور غير متطابقتين',
    update: 'تحديث',
    every_shift: 'كل دوام',
    daily: 'مرة يومياً',
    weekly: 'مرة أسبوعياً',
    noTasks: 'لم يتم إعداد أي مهام لهذا الموقع بعد.',
    offline: 'أنت غير متصل. لا يمكن الحفظ الآن.',
  },
};

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('sv_lang') || 'en');

  // Arabic needs the whole document flipped, not just the text.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('sv_lang', lang);
  }, [lang]);

  const value = useMemo(
    () => ({
      lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      setLang: setLangState,
      toggle: () => setLangState((l) => (l === 'en' ? 'ar' : 'en')),
      t: (key) => dict[lang][key] ?? dict.en[key] ?? key,
      // Picks nameEn / nameAr style fields off an API object.
      // Arabic is optional in the data: a row imported from a sheet with no
      // Arabic stores NULL. Fall back to English so the technician always has
      // a readable line, and treat blank the same as missing.
      pick: (obj, base) => {
        const wanted = obj?.[`${base}${lang === 'ar' ? 'Ar' : 'En'}`];
        if (wanted != null && String(wanted).trim() !== '') return wanted;
        return obj?.[`${base}En`] ?? '';
      },
    }),
    [lang]
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside LangProvider');
  return ctx;
};
