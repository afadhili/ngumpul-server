import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST ?? "localhost";
const port = Number(process.env.SMTP_PORT ?? 1025);
const secure = process.env.SMTP_SECURE === "true";
const from = process.env.EMAIL_FROM ?? "Ngumpul <no-reply@localhost>";
const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
        : {}),
});

const OTP_EXPIRY_MINUTES = 10;

type OtpPurpose = {
    eyebrow: string;
    title: string;
    description: string;
    label: string;
    subject: string;
    textAction: string;
    ignoreNote: string;
};

const purposes: Record<string, OtpPurpose> = {
    "email-verification": {
        eyebrow: "Verifikasi email",
        title: "Konfirmasi alamat emailmu",
        description: "Masukkan kode di bawah ini untuk menyelesaikan verifikasi dan mengaktifkan akun Ngumpul-mu.",
        label: "verifikasi email",
        subject: "Verifikasi email Ngumpul",
        textAction: "verifikasi alamat email",
        ignoreNote: "Jika kamu tidak membuat akun Ngumpul, abaikan email ini. Tidak ada akun yang aktif tanpa verifikasi.",
    },
    "forget-password": {
        eyebrow: "Reset kata sandi",
        title: "Buat kata sandi baru",
        description: "Kami menerima permintaan untuk mengatur ulang kata sandi akun Ngumpul ini. Masukkan kode berikut untuk melanjutkan.",
        label: "reset kata sandi",
        subject: "Reset kata sandi Ngumpul",
        textAction: "mengatur ulang kata sandi",
        ignoreNote: "Jika kamu tidak meminta reset kata sandi, abaikan email ini. Kata sandi akunmu tidak akan berubah.",
    },
    "sign-in": {
        eyebrow: "Kode masuk",
        title: "Masuk ke Ngumpul",
        description: "Gunakan kode ini untuk masuk ke akunmu tanpa perlu mengetik kata sandi.",
        label: "masuk ke akun",
        subject: "Kode masuk Ngumpul",
        textAction: "masuk ke akun",
        ignoreNote: "Jika kamu tidak mencoba masuk, abaikan email ini dan pertimbangkan untuk mengganti kata sandi akunmu.",
    },
    "change-email": {
        eyebrow: "Perubahan email",
        title: "Konfirmasi email baru",
        description: "Gunakan kode ini untuk mengonfirmasi alamat email baru yang akan dipakai akun Ngumpul-mu.",
        label: "mengubah alamat email",
        subject: "Konfirmasi email baru Ngumpul",
        textAction: "mengonfirmasi alamat email baru",
        ignoreNote: "Jika kamu tidak meminta perubahan email, abaikan email ini. Alamat email akunmu tidak akan berubah.",
    },
};

const fallbackPurpose: OtpPurpose = {
    eyebrow: "Kode keamanan",
    title: "Kode keamanan Ngumpul",
    description: "Gunakan kode berikut untuk melanjutkan tindakan keamanan pada akun Ngumpul-mu.",
    label: "tindakan keamanan",
    subject: "Kode keamanan Ngumpul",
    textAction: "melanjutkan tindakan keamanan",
    ignoreNote: "Jika kamu tidak meminta kode ini, abaikan email ini.",
};

function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character] ?? character);
}

function renderText(otp: string, purpose: OtpPurpose) {
    return [
        "Halo,",
        "",
        `Kode OTP Ngumpul untuk ${purpose.textAction} adalah:`,
        "",
        otp,
        "",
        `Kode ini berlaku selama ${OTP_EXPIRY_MINUTES} menit dan hanya dapat digunakan sekali.`,
        "Jangan bagikan kode ini kepada siapa pun, termasuk pihak yang mengaku dari Ngumpul.",
        "",
        purpose.ignoreNote,
        "",
        "Email ini dikirim otomatis. Jangan balas email ini.",
        "— Tim Ngumpul",
    ].join("\n");
}

function renderHtml(otp: string, purpose: OtpPurpose) {
    const safeOtp = escapeHtml(otp);
    return `<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>${escapeHtml(purpose.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2430;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Gunakan kode ${safeOtp} untuk ${escapeHtml(purpose.label)}. Kode berlaku ${OTP_EXPIRY_MINUTES} menit.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5fb;">
        <tr>
            <td align="center" style="padding:32px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 32px rgba(31,36,48,0.08);">
                    <tr>
                        <td style="background:#111827;padding:22px 32px;">
                            <span style="font-size:22px;line-height:1;font-weight:800;letter-spacing:-0.6px;color:#ffffff;">ngumpul<span style="color:#fbbf24;">.</span></span>
                            <span style="display:block;margin-top:4px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#9ca3af;">Ruang untuk komunitasmu</span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:40px 36px 28px;">
                            <p style="margin:0 0 10px;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#6366f1;">${escapeHtml(purpose.eyebrow)}</p>
                            <h1 style="margin:0 0 12px;font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-0.4px;color:#111827;">${escapeHtml(purpose.title)}</h1>
                            <p style="margin:0 0 26px;font-size:15px;line-height:1.7;color:#4b5563;">${escapeHtml(purpose.description)}</p>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;">
                                <tr>
                                    <td align="center" style="padding:24px 12px 22px;">
                                        <p style="margin:0 0 10px;font-size:10px;line-height:1.4;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#6b7280;">Kode OTP</p>
                                        <p style="margin:0;font-family:'Courier New',Courier,monospace;font-size:38px;line-height:1.1;font-weight:800;letter-spacing:10px;color:#111827;white-space:nowrap;">${safeOtp}</p>
                                        <p style="margin:12px 0 0;font-size:12px;line-height:1.4;color:#6b7280;">Berlaku ${OTP_EXPIRY_MINUTES} menit &middot; sekali pakai</p>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
                                <tr>
                                    <td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#92400e;"><strong>Jangan bagikan kode ini.</strong> Ngumpul tidak pernah meminta kode OTP melalui telepon, chat, atau pesan langsung.</td>
                                </tr>
                            </table>
                            <p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#6b7280;">${escapeHtml(purpose.ignoreNote)}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:20px 36px;background:#f9fafb;border-top:1px solid #eef0f4;">
                            <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#6b7280;">Email ini dikirim otomatis dari Ngumpul. Jangan balas email ini.</p>
                            <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">Butuh bantuan? Hubungi admin komunitasmu.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export async function sendVerificationOtpEmail(email: string, otp: string, type: string) {
    const purpose = purposes[type] ?? fallbackPurpose;
    await transporter.sendMail({
        from,
        to: email,
        subject: purpose.subject,
        text: renderText(otp, purpose),
        html: renderHtml(otp, purpose),
    });
}
