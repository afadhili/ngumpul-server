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
const logoCid = "ngumpul-mark@afadhili.my.id";

// The frontend favicon, rasterized for email clients and embedded with the message.
const logoPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAADgAAAA4BAMAAABaqCYtAAAAMFBMVEXX3d+Yp6xOaXEtTVcXOUV1ipELLzsILTkJ" +
    "LTi6xMdlfIQILTixvcAILTn9/v4AAACrKTeHAAAAEHRSTlP////////lmTP//3f//v8AUot3CgAAAnFJREFUeNqF" +
    "1c1LFGEcwPHvs47p+rIMCVYHYdAOGyms2sGsQCIvvcBCSBeLNYguHqYXuhleDDIP+ycs0R+wiGmBiRcPxop7q0Bt" +
    "CAp6AZfZdd91OuzuzDPTrj2nGT77e15+v2d/IywoPH+Id8wHdRAWhbkI/47Cex1hsaZRbxSD+MjXN07MIqwGgXB0" +
    "VuS/02gs+qyGhtF0MtgQh5SU9DbxFa7O26+WhNkrewBd/fEail3bbiQrD+atmvrswFdJ6Orr1Qgs6V6cjpIe2Uls" +
    "bdync9mDuQ3S0ytA24tFfofdOG2Yk1EAWi6EeOvGeyzFqo/+FToiMmbC6S/21lrH2ASgepSpeLeD5M+ky1JkhItS" +
    "plrjnREHD8K5mJzVGIYzbabn9CcZMz3Zgh05wx1XPXwcOdMalWns0aZZDqbMmLuUqoSzAhgHxnWY0EEN6DbqCpQT" +
    "KTKJFQ5Xl0El5ZyzGR7QTSd7ZPkGIQmNPKgITAR+mnGVTGuFBTbxaaMUtX4wUAGl8psSNO2HaN+Gtm1qWIlcL3tu" +
    "ZciM2hj1Xu2xDmfNZMD9L8yFpfQNedJ3SNHBR6RcOFMpbwXbPUsm0Rx8TFi2g2Q65mDEveYkfVKGUiW5ZAfrnHMw" +
    "FxZy4ALluIOCIuTGq3Y7yhMp8SV+Mnc9EYwAuZtrZGZxLvVUfKS0BZiD18ofDMy71R0oABq/9gACuwDms9ruxC4w" +
    "aACnBv4kAcynL2s7U4CsAebwZwrD+ym//7xzKiWqY0HX5Y/QsurpjYoK7b1NO/X6kFBUYKt+kxIi96NhB3vtE417" +
    "n3psS/Ux2ijwzf/aOJdide0diOM+HX8BGeTPrcYE1ycAAAAASUVORK5CYII=",
    "base64",
);

// Match the authentication palette in web/src/assets/main.css.
const colors = {
    brand: "#082d39",
    surface: "#ffffff",
    background: "#f4f6f8",
    ink: "#1b1f24",
    muted: "#53606c",
    border: "#b8c1cb",
    noticeBackground: "#edf7f9",
    noticeInk: "#15566a",
};

type OtpPurpose = {
    title: string;
    description: string;
    label: string;
    subject: string;
    textAction: string;
    ignoreNote: string;
};

const purposes: Record<string, OtpPurpose> = {
    "email-verification": {
        title: "Konfirmasi alamat emailmu",
        description: "Masukkan kode di bawah ini untuk menyelesaikan verifikasi dan mengaktifkan akun Ngumpul-mu.",
        label: "verifikasi email",
        subject: "Verifikasi email Ngumpul",
        textAction: "verifikasi alamat email",
        ignoreNote: "Jika kamu tidak membuat akun Ngumpul, abaikan email ini. Tidak ada akun yang aktif tanpa verifikasi.",
    },
    "forget-password": {
        title: "Buat kata sandi baru",
        description: "Kami menerima permintaan untuk mengatur ulang kata sandi akun Ngumpul ini. Masukkan kode berikut untuk melanjutkan.",
        label: "reset kata sandi",
        subject: "Reset kata sandi Ngumpul",
        textAction: "mengatur ulang kata sandi",
        ignoreNote: "Jika kamu tidak meminta reset kata sandi, abaikan email ini. Kata sandi akunmu tidak akan berubah.",
    },
    "sign-in": {
        title: "Masuk ke Ngumpul",
        description: "Gunakan kode ini untuk masuk ke akunmu tanpa perlu mengetik kata sandi.",
        label: "masuk ke akun",
        subject: "Kode masuk Ngumpul",
        textAction: "masuk ke akun",
        ignoreNote: "Jika kamu tidak mencoba masuk, abaikan email ini dan pertimbangkan untuk mengganti kata sandi akunmu.",
    },
    "change-email": {
        title: "Konfirmasi email baru",
        description: "Gunakan kode ini untuk mengonfirmasi alamat email baru yang akan dipakai akun Ngumpul-mu.",
        label: "mengubah alamat email",
        subject: "Konfirmasi email baru Ngumpul",
        textAction: "mengonfirmasi alamat email baru",
        ignoreNote: "Jika kamu tidak meminta perubahan email, abaikan email ini. Alamat email akunmu tidak akan berubah.",
    },
};

const fallbackPurpose: OtpPurpose = {
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
    const digits = /^[0-9]{6}$/.test(otp)
        ? Array.from(otp, digit => `<span class="otp-digit" style="display:inline-block;box-sizing:border-box;width:32px;margin-right:4px;border:1px solid ${colors.border};border-radius:8px;background-color:${colors.background};text-align:center;line-height:46px;">${digit}</span>`).join("")
        : safeOtp;
    return `<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${escapeHtml(purpose.subject)}</title>
    <style>
        @media screen and (min-width: 360px) {
            .otp-digit { width: 36px !important; }
        }
        @media screen and (min-width: 480px) {
            .email-content { padding: 32px !important; }
            .otp-digit { width: 46px !important; margin-right: 6px !important; }
        }
        @media (prefers-color-scheme: dark) {
            .email-background, .otp-digit { background-color: #192730 !important; }
            .email-card { background-color: #121c23 !important; }
            .email-card, .email-footer, .otp-digit { border-color: #667986 !important; }
            .email-ink { color: #edf5fa !important; }
            .email-muted { color: #aebec8 !important; }
            .security-note { background-color: #182f39 !important; color: #afe7f3 !important; }
        }
    </style>
</head>
<body class="email-background" style="margin:0;padding:0;background-color:${colors.background};font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:${colors.ink};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">Gunakan kode ${safeOtp} untuk ${escapeHtml(purpose.label)}. Kode berlaku ${OTP_EXPIRY_MINUTES} menit.</div>
    <table role="presentation" class="email-background" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${colors.background};">
        <tr>
            <td align="center" style="padding:24px 12px;">
                <!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
                <table role="presentation" class="email-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:${colors.surface};border:1px solid ${colors.border};border-radius:16px;text-align:left;">
                    <tr>
                        <td style="padding:16px 22px;background-color:${colors.brand};border-radius:15px 15px 0 0;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td style="padding-right:10px;"><img src="cid:${logoCid}" width="28" height="28" alt="" style="display:block;border:0;"></td>
                                    <td style="color:#ffffff;font-size:22px;line-height:1.25;font-weight:750;letter-spacing:-0.5px;">Ngumpul</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td class="email-content" style="padding:26px 20px 24px;">
                            <h1 class="email-ink" style="margin:0 0 8px;font-size:26px;line-height:1.2;font-weight:750;letter-spacing:-0.5px;color:${colors.ink};">${escapeHtml(purpose.title)}</h1>
                            <p class="email-muted" style="margin:0 0 22px;font-size:16px;line-height:1.5;color:${colors.muted};">${escapeHtml(purpose.description)}</p>
                            <p class="email-ink" style="margin:0 0 8px;font-size:14px;line-height:1.5;font-weight:650;color:${colors.ink};">Kode OTP 6 angka</p>
                            <p class="email-ink otp-code" dir="ltr" style="margin:0 0 8px;font-size:22px;line-height:46px;font-weight:700;font-variant-numeric:tabular-nums;color:${colors.ink};">${digits}</p>
                            <p class="email-muted" style="margin:0 0 24px;font-size:14px;line-height:1.5;color:${colors.muted};">Berlaku ${OTP_EXPIRY_MINUTES} menit &middot; sekali pakai</p>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td class="security-note" style="padding:12px 14px;border-radius:8px;background-color:${colors.noticeBackground};color:${colors.noticeInk};font-size:14px;line-height:1.5;"><strong>Jangan bagikan kode ini.</strong> Ngumpul tidak pernah meminta kode OTP melalui telepon, chat, atau pesan langsung.</td>
                                </tr>
                            </table>
                            <p class="email-muted" style="margin:16px 0 0;font-size:14px;line-height:1.5;color:${colors.muted};">${escapeHtml(purpose.ignoreNote)}</p>
                        </td>
                    </tr>
                    <tr>
                        <td class="email-footer email-muted" style="padding:16px 20px;border-top:1px solid ${colors.border};color:${colors.muted};font-size:13px;line-height:1.5;">
                            <p style="margin:0 0 4px;">Email ini dikirim otomatis dari Ngumpul. Jangan balas email ini.</p>
                            <p style="margin:0;">Butuh bantuan? Hubungi admin komunitasmu.</p>
                        </td>
                    </tr>
                </table>
                <!--[if mso]></td></tr></table><![endif]-->
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export async function sendVerificationOtpEmail(email: string, otp: string, type: string) {
    const purpose = Object.hasOwn(purposes, type) ? purposes[type] : fallbackPurpose;
    await transporter.sendMail({
        from,
        to: email,
        subject: purpose.subject,
        text: renderText(otp, purpose),
        html: renderHtml(otp, purpose),
        attachments: [{ filename: "ngumpul.png", content: logoPng, contentType: "image/png", cid: logoCid }],
    });
}
