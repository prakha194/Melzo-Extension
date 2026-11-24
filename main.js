/* YouTube Music Download Helper — Orpheon(旧Myspoti)向けdownload-source拡張
 * Copyright (C) 2026 y-exe
 * SPDX-License-Identifier: GPL-3.0-only
 * Modified 2026 by Prashant for the Melzo build (new extension id and metadata);
 * the matching and playback code is unchanged from the original.
 * 照合の基準は私のMyspotiフォークから、アルバム加減・リマスター減点の発想はspotDLから
 * (出典: THIRD_PARTY_NOTICES.md)。Spotify音源・アカウント・外部サーバーは使わない。
 */
(function () {
    'use strict';
    var MUSIC = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false';
    var API = 'https://youtubei.googleapis.com/youtubei/v1/';
    // クライアント/セッション項目はNewPipeExtractorとyt-dlpに準拠。動的なコード実行はしない。
    var AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    var CREDITS = /\s*[〔【][^〕】]*cv\s*[:：][^〕】]*[〕】]/gi;
    // 版違いの語(別録音の確実な印)。曲名に同じ語を含まない候補は拒否する。
    // リマスター表記は下のREMASTERへ: 公式masterの表記に付くことが多く、拒否ではなく減点。
    var VERSIONS = /\b(live|cover|remix|acoustic|instrumental|karaoke|slowed|sped[ -]?up|nightcore|reverb|8d)\b|ライブ|カバー|歌ってみた|弾いてみた|カラオケ|オルゴール|라이브|커버|리믹스|노래방|부르기|翻唱|现场|現場|混音|卡拉ok|伴奏|кавер|караоке|ремикс|инструментал|লাইভ|কভার|রিমিক্স|ক্যারাওকে|ইনস্ট্রুমেন্টাল|லைவ்|கவர்|ரீமிக்ஸ்|கரோக்கே|లైవ్|కవర్|రీమిక్స్|కరోకే|ಲೈವ್|ಕವರ್|ರೀಮಿಕ್ಸ್|ಕರಾಯೋಕೆ|ലൈവ്|കവർ|റീമിക്സ്|കരോക്കെ|લાઈવ|કવર|રીમિક્સ|કેરોકે|ਲਾਈਵ|ਕਵਰ|ਰੀਮਿਕਸ|ਕਰਾਓਕੇ|زنده|کاور|ریمیکس|بی‌کلام|بی کلام|لائیو|کور|ریمکس|ცოცხალი|ქავერი|რემიქსი|կենդանի|քավեր|ռեմիքս|ቀጥታ|ካቨር|ሪሚክስ|တိုက်ရိုက်|ផ្ទាល់/gi;
    // リマスター表記(減点対象)。「(Remastered 2011)」等。
    var REMASTER = /\bremaster(?:ed)?\b/gi;
    // 検索は曲の表記言語を優先し、英語をフォールバックに(全地域で索引されている)。
    var LANG = {
        ja: ['ja', 'en'], ko: ['ko', 'en'], zh: ['zh-TW', 'zh-CN', 'en'],
        ru: ['ru', 'en'], ar: ['ar', 'en'], hi: ['hi', 'en'], th: ['th', 'en'],
        el: ['el', 'en'], he: ['he', 'en'], latin: ['en'],
        bn: ['bn', 'en'], ta: ['ta', 'en'], te: ['te', 'en'], kn: ['kn', 'en'], ml: ['ml', 'en'],
        gu: ['gu', 'en'], pa: ['pa', 'en'], fa: ['fa', 'en'], ur: ['ur', 'en'],
        lo: ['lo', 'en'], my: ['my', 'en'], km: ['km', 'en'], ka: ['ka', 'en'], hy: ['hy', 'en'],
        am: ['am', 'en'],
    };
    var REGION = { ja: 'JP', ko: 'KR', 'zh-TW': 'TW', 'zh-CN': 'US', en: 'US', ru: 'RU',
        ar: 'SA', hi: 'IN', th: 'TH', el: 'GR', he: 'IL', bn: 'IN', ta: 'IN', te: 'IN',
        kn: 'IN', ml: 'IN', gu: 'IN', pa: 'IN', fa: 'US', ur: 'PK', lo: 'LA', my: 'MM',
        km: 'KH', ka: 'GE', hy: 'AM', am: 'ET' };
    var cache = {};
    // 返す音源の実用上限(1GiB)。公式楽曲でこれを超えるのは異常値(誤提供・汚染)扱いにする。
    var MAX_SIZE = 1073741824;
    // 検索クライアントの版。本体がHTTP 400/403で拒否してきたときだけ予備の版に切り替える。
    var CLIENT_VERSIONS = ['1.20251013.03.00', '1.20241111.01.00'], CLIENT = 0;
    // 匿名セッション(visitorData)は1時間だけ再利用する。ダウンロード1件ごとの取得要求を省く。
    var SESSION = null;

    // ユーザーに見える文字はmyspoti.locale(本体の表示言語)に従う。当て方はmanifestの
    // translationsと同じ(完全一致→基言語→英語)。訳はi18n.jsonからpack時に差し込まれる。
    var MESSAGES = {
        // 台帳待ちの開始(1回だけ出る)。
        'waiting-cap': {
            en: "Waiting: YouTube Music's per-minute cap is near",
        },
        // 本体の台帳も満ちて待ちきれないときに投げる(本体はこの曲を後で再試行する)。
        'rate-limited-throw': {
            en: 'YouTube Music is rate limited, please try again in a minute',
        },
        // 本体の毎分上限に触れて待機に入るとき(1回だけ出る)。
        'rate-limited-log': {
            en: 'Rate limited by the per-minute cap, waiting',
        },
        // 検索が予算内で答えなかった(8回とも失敗)。
        'search-no-answer': {
            en: 'YouTube Music did not answer the search',
        },
        // 検索応答にerrorが入っていた。
        'search-refused': {
            en: 'YouTube Music refused the search',
        },
        // 匿名セッション(visitorData)の取得に失敗した。
        'session-failed': {
            en: 'Could not get an anonymous YouTube Music session',
        },
        // player応答のplayabilityStatusがOK以外({0}: その値)。
        'audio-failed': {
            en: 'Could not get the audio: {0}',
        },
        // 範囲取得(先頭・末尾)が206で答えなかった({0}: 3xxまたはステータス)。
        'range-refused': {
            en: 'Range requests refused (HTTP {0})',
        },
        // 範囲取得の応答検査中の例外。
        'audio-verify-failed': {
            en: 'Could not verify the audio URL',
        },
        // status: 台帳が温かく、保存の枠を消費しないよう確認を省いたときのdetail。
        'status-skipped': {
            en: 'Status check skipped: the per-minute cap is near',
        },
        // status: 応答はあるがYouTube Musicに届かなかった({0}: HTTPステータス)。
        'status-unreachable': {
            en: 'Could not reach YouTube Music (HTTP {0})',
        },
        // status: タイムアウト・DNS失敗など、本当に届かないときのdetail。
        'status-offline': {
            en: 'Cannot reach YouTube Music right now',
        },
        // status: 想定外の例外で確認できなかった({0}: 例外の要約)。
        'status-error': {
            en: 'Status check failed, showing as live: {0}',
        },
        // 1巡目で公式曲が見つからず2巡目に入るとき。
        'research': {
            en: 'No official song in the rankings, searching again',
        },
        // 検索または音源取得で例外が起きた({0}: 要約した例外)。
        'hook-failed': {
            en: 'Search or fetch failed: {0}',
        },
        // 一致候補はあったが、どの音源も取得・検査を通らなかった。
        'candidates-not-fetched': {
            en: 'Found matching candidates but could not fetch the audio',
        },
        // 一致候補もなく予算を使い切った(見つからない扱い)。
        'not-found': {
            en: 'No official song matched beyond doubt',
        },
    };
    // i18n.jsonの訳の差し込み位置(pack.jsがこの行を置き換える。単体では英語で動く)。
    var MESSAGES_I18N = {"waiting-cap":{"ja":"YouTube Musicのレート制限に近づいたため待機します","ko":"대기 중: YouTube Music의 분당 요청 한도에 가까워졌습니다","zh":"等待中：即将达到 YouTube Music 的每分钟请求上限","zh-hk":"等待中：即將達到 YouTube Music 的每分鐘請求上限","zh-tw":"等待中：即將達到 YouTube Music 的每分鐘請求上限","es":"Esperando: cerca del límite de solicitudes por minuto de YouTube Music","pt":"À espera: perto do limite de pedidos por minuto do YouTube Music","pt-br":"Aguardando: perto do limite de solicitações por minuto do YouTube Music","fr":"En attente : la limite de requêtes par minute de YouTube Music est proche","de":"Warten: das Anfragelimit von YouTube Music pro Minute ist fast erreicht","it":"In attesa: vicino al limite di richieste al minuto di YouTube Music","nl":"Wachten: het verzoeklimiet van YouTube Music per minuut is bijna bereikt","ca":"En espera: s'acosta al límit de peticions per minut de YouTube Music","gl":"Á espera: acércase ao límite de peticións por minuto de YouTube Music","eu":"Zain: YouTube Music-en minutuko eskaera mugara hurbiltzen","pl":"Oczekiwanie: zbliżanie się do limitu zapytań na minutę w YouTube Music","cs":"Čekání: blíží se limit požadavků za minutu u YouTube Music","sk":"Čakanie: blíži sa limit požiadaviek za minútu v YouTube Music","sl":"Čakanje: bliža se omejitev zahtev na minuto v YouTube Music","hr":"Čekanje: približava se ograničenje zahtjeva u minuti za YouTube Music","bs":"Čekanje: približava se ograničenje zahtjeva u minuti za YouTube Music","sr":"Чекање: приближава се ограничење захтева у минуту за YouTube Music","bg":"Изчакване: приближава се лимитът за заявки в минута в YouTube Music","mk":"Чекање: се приближува лимитот за барања во минута во YouTube Music","lt":"Laukiama: artėjama prie YouTube Music užklausų per minutę ribos","lv":"Gaida: tuvojas YouTube Music pieprasījumu minūtes robeža","et":"Ootamine: läheneb YouTube Music'i päringute minutipiir","hu":"Várakozás: közeledik a YouTube Music percenkénti kéréskorlátja","ro":"În așteptare: se apropie limita de cereri pe minut a YouTube Music","da":"Venter: nærmer sig YouTube Musics grænse for forespørgsler pr. minut","nb":"Venter: nærmer seg grensen for forespørsler per minutt i YouTube Music","sv":"Väntar: närmar sig YouTube Musics gräns för förfrågningar per minut","is":"Bíð: nálgast hámark beiðna á mínútu hjá YouTube Music","fi":"Odotetaan: lähestytään YouTube Musicin kyselyrajaa minuutissa","ru":"Ожидание: близко к минутному лимиту запросов YouTube Music","uk":"Очікування: близько до хвилинного ліміту запитів YouTube Music","tr":"Bekleniyor: YouTube Music'un dakika başına istek sınırına yaklaşıldı","el":"Αναμονή: πλησιάζει το όριο αιτημάτων ανά λεπτό του YouTube Music","he":"ממתין: מגבלת הבקשות לדקה של YouTube Music קרובה","ar":"في انتظار: أوشكنا على بلوغ حدّ الطلبات في الدقيقة في YouTube Music","fa":"در حال انتظار: نزدیک شدن به سقف درخواست‌های دقیقه‌ای YouTube Music","ur":"انتظار: YouTube Music کی فی منٹ درخواست حد کے قریب","hi":"प्रतीक्षा: YouTube Music की प्रति मिनट सीमा पास आ रही है","bn":"অপেক্ষা: YouTube Music-এর প্রতি মিনিটের সীমার কাছে","ta":"காத்திருப்பு: YouTube Music-இன் நிமிடத்திற்கான வரம்பை நெருங்குகிறது","te":"వేచి ఉన్నాము: YouTube Music యొక్క నిమిషానికి పరిమితిని సమీపిస్తోంది","kn":"ನಿರೀಕ್ಷೆ: YouTube Music ನ ನಿಮಿಷಕ್ಕಿರುವ ಮಿತಿಯನ್ನು ಸಮೀಪಿಸಲಾಗುತ್ತಿದೆ","ml":"കാത്തിരിപ്പ്: YouTube Music-ന്റെ മിനിറ്റിലെ പരിധിയെ സമീപിക്കുന്നു","mr":"प्रतीक्षा: YouTube Music ची प्रति मिनिट मर्यादा जवळ येत आहे","gu":"રાહ જોવા: YouTube Music ની પ્રતિ મિનિટ મર્યાદા નજીક આવી રહી છે","pa":"ਉਡੀਕ: YouTube Music ਦੀ ਪ੍ਰਤੀ ਮਿੰਟ ਸੀਮਾ ਨੇੜੇ ਆ ਰਹੀ ਹੈ","ne":"प्रतीक्षा: YouTube Music को प्रति मिनेट सीमा नजिकै छ","or":"ଅପେಕ୍ଷା: YouTube Music ର ପ୍ରତି ମିନିଟ୍ ସୀମା ପାଖରେ ଅଛି","th":"กำลังรอ: ใกล้ถึงขีดจำกัดต่อนาทีของ YouTube Music","vi":"Đang chờ: gần tới giới hạn yêu cầu mỗi phút của YouTube Music","id":"Menunggu: mendekati batas permintaan per menit YouTube Music","ms":"Menunggu: hampir mencapai had permintaan seminit YouTube Music","tl":"Naghihintay: malapit nang maabot ang limitasyon ng YouTube Music kada minuto","sw":"Inasubiri: inakaribia kikomo cha maombi kwa dakika cha YouTube Music","af":"Wag: nader aan YouTube Music se perminuut-versoekgrens","az":"Gözləyir: YouTube Music-un dəqiqəlik sorğu həddinə yaxınlaşır","am":"በመጠበቅ ላይ: የYouTube Music የደቂቃ ገደብ እየቀረበ ነው","zu":"Kulindele: kusondela umkhawulo wezicelo ngemizuzu we-YouTube Music"},"rate-limited-throw":{"ja":"YouTube Musicのレート制限中です。しばらく待ってから再試行してください","ko":"YouTube Music의 요청 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요","zh":"YouTube Music 触发了频率限制，请稍后再试","zh-hk":"YouTube Music 已達請求上限，請稍後再試","zh-tw":"YouTube Music 已達請求上限，請稍後再試","es":"YouTube Music limitó las solicitudes; inténtalo de nuevo en un minuto","pt":"O YouTube Music limitou os pedidos; tente novamente dentro de um minuto","pt-br":"O YouTube Music limitou as solicitações; tente novamente em um minuto","fr":"YouTube Music limite les requêtes ; réessayez dans une minute","de":"YouTube Music begrenzt die Anfragen, bitte in einer Minute erneut versuchen","it":"YouTube Music ha limitato le richieste, riprova tra un minuto","nl":"YouTube Music beperkt de verzoeken, probeer het over een minuut opnieuw","ca":"YouTube Music ha limitat les peticions; torna-ho a provar d'aquí a un minut","gl":"YouTube Music limitou as peticións; téntao de novo nun minuto","eu":"YouTube Music-ek eskaerak mugatu ditu; saiatu berriro minutu bat barru","pl":"YouTube Music ograniczył żądania, spróbuj ponownie za minutę","cs":"YouTube Music omezil požadavky, zkuste to znovu za minutu","sk":"YouTube Music obmedzil požiadavky, skúste to znova o minútu","sl":"YouTube Music je omejil zahteve, poskusite znova čez minuto","hr":"YouTube Music je ograničio zahtjeve, pokušajte ponovno za minutu","bs":"YouTube Music je ograničio zahtjeve, pokušajte ponovno za minutu","sr":"YouTube Music је ограничио захтеве, покушајте поново за минут","bg":"YouTube Music ограничи заявките, опитайте отново след минута","mk":"YouTube Music го ограничи барањата, обидете се повторно за една минута","lt":"YouTube Music apribojo užklausas, bandykite dar kartą po minutės","lv":"YouTube Music ierobežoja pieprasījumus, mēģiniet vēlreiz pēc minūtes","et":"YouTube Music piiras päringuid, proovige minuti pärast uuesti","hu":"A YouTube Music korlátozta a kéréseket, próbáld újra egy perc múlva","ro":"YouTube Music a limitat cererile, reîncearcă într-un minut","da":"YouTube Music har begrænset forespørgslerne, prøv igen om et minut","nb":"YouTube Music har begrenset forespørslene, prøv igjen om et minutt","sv":"YouTube Music har begränsat förfrågningarna, försök igen om en minut","is":"YouTube Music takmarkar beiðnir, reyndu aftur eftir mínútu","fi":"YouTube Music rajoitti pyynnöt, yritä uudelleen minuutin kuluttua","ru":"YouTube Music ограничивает запросы, попробуйте снова через минуту","uk":"YouTube Music обмежує запити, спробуйте ще раз за хвилину","tr":"YouTube Music istek sınırına ulaştı, lütfen bir dakika sonra yeniden deneyin","el":"Το YouTube Music περιόρισε τα αιτήματα, δοκιμάστε ξανά σε ένα λεπτό","he":"YouTube Music הגביל בקשות, נסו שוב בעוד דקה","ar":"حدّت YouTube Music من الطلبات، يُرجى المحاولة مجددًا بعد دقيقة","fa":"YouTube Music درخواست‌ها را محدود کرده، لطفاً یک دقیقه دیگر دوباره تلاش کنید","ur":"YouTube Music نے درخواستیں محدود کر دی ہیں، براہ کرم ایک منٹ بعد دوبارہ کوشش کریں","hi":"YouTube Music पर अनुरोध सीमा लागू है, कृपया एक मिनट में फिर कोशिश करें","bn":"YouTube Music অনুরোধ সীমিত করেছে, এক মিনিট পরে আবার চেষ্টা করুন","ta":"YouTube Music கோரிக்கைகளை வரம்பிட்டுள்ளது, ஒரு நிமிடத்தில் மீண்டும் முயற்சிக்கவும்","te":"YouTube Music అభ్యర్థనలను పరిమితం చేసింది, ఒక నిమిషంలో మళ్లీ ప్రయత్నించండి","kn":"YouTube Music ವಿನಂತಿಗಳನ್ನು ಮಿತಿಗೊಳಿಸಿದೆ, ಒಂದು ನಿಮಿಷದಲ್ಲಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ","ml":"YouTube Music അഭ്യർത്ഥനകൾ പരിമിതപ്പെടുത്തി, ഒരു മിനിറ്റിനുള്ളിൽ വീണ്ടും ശ്രമിക്കുക","mr":"YouTube Music ने विनंत्या मर्यादित केल्या आहेत, एका मिनिटाने पुन्हा प्रयत्न करा","gu":"YouTube Music એ વિનંતીઓ મર્યાદિત કરી છે, એક મિનિટમાં ફરી પ્રયાસ કરો","pa":"YouTube Music ਨੇ ਬੇਨਤੀਆਂ ਸੀਮਤ ਕਰ ਦਿੱਤੀਆਂ ਹਨ, ਇੱਕ ਮਿੰਟ ਵਿੱਚ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ","ne":"YouTube Music ले अनुरोधहरू सीमित गरेको छ, एक मिनेटमा फेरि प्रयास गर्नुहोस्","or":"YouTube Music ଅନୁରୋଧ ସୀମିତ କରିଛି, ଏକ ମିନିଟ୍ ପରେ ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ","th":"YouTube Music จำกัดจำนวนคำขอ กรุณาลองอีกครั้งในอีกหนึ่งนาที","vi":"YouTube Music đã giới hạn số yêu cầu, vui lòng thử lại sau một phút","id":"YouTube Music membatasi permintaan, coba lagi dalam satu menit","ms":"YouTube Music menghadkan permintaan, cuba lagi dalam satu minit","tl":"Nag-limit ang YouTube Music sa mga request, subukan ulit pagkatapos ng isang minuto","sw":"YouTube Music imepunguza maombi, jaribu tena baada ya dakika moja","af":"YouTube Music beperk versoeke, probeer weer oor 'n minuut","az":"YouTube Music sorğuları məhdudlaşdırdı, bir dəqiqə sonra yenidən cəhd edin","am":"YouTube Music ጥያቄዎችን ገድቧል፣ እባክዎ ከአንድ ደቂቃ በኋላ እንደገና ይሞክሩ","zu":"I-YouTube Music ikhawulezise izicelo, zama futhi ngemizuzu elilodwa"},"rate-limited-log":{"ja":"レート制限中: 1分あたりの上限に達したため待機します","ko":"분당 요청 한도에 걸렸습니다. 대기 중","zh":"触发每分钟请求上限，等待中","zh-hk":"觸發每分鐘請求上限，等待中","zh-tw":"觸發每分鐘請求上限，等待中","es":"Límite de solicitudes por minuto alcanzado; esperando","pt":"Limite de pedidos por minuto atingido; à espera","pt-br":"Limite de solicitações por minuto atingido; aguardando","fr":"Limite de requêtes par minute atteinte ; en attente","de":"Anfragelimit pro Minute erreicht, wird gewartet","it":"Limite di richieste al minuto raggiunto, in attesa","nl":"Verzoeklimiet per minuut bereikt, er wordt gewacht","ca":"Assolit el límit per minut, en espera","gl":"Acadido o límite por minuto, á espera","eu":"Minutuko mugara iritsita, zain","pl":"Osiągnięto limit żądań na minutę, oczekiwanie","cs":"Dosažen limit požadavků za minutu, čeká se","sk":"Dosiahnutý limit požiadaviek za minútu, čaká sa","sl":"Dosežena omejitev na minuto, čakanje","hr":"Dosegnuto ograničenje u minuti, čekanje","bs":"Dosegnuto ograničenje u minuti, čekanje","sr":"Досегнуто ограничење у минуту, чекање","bg":"Достигнат минутен лимит, изчакване","mk":"Достигнат лимит во минута, чекање","lt":"Pasiekta minutės riba, laukiama","lv":"Sasniegta minūtes robeža, gaida","et":"Minutipiir täitus, ootamine","hu":"Elérve a percenkénti korlátot, várakozás","ro":"Limita pe minut a fost atinsă, în așteptare","da":"Grænsen pr. minut er nået, venter","nb":"Grensen per minutt er nådd, venter","sv":"Gränsen per minut är nådd, väntar","is":"Hámarki á mínútu er náð, bíð","fi":"Minuuttiraja täyttyi, odotetaan","ru":"Достигнут минутный лимит запросов, ожидание","uk":"Досягнуто хвилинного ліміту запитів, очікування","tr":"Dakikalık istek sınırına ulaşıldı, bekleniyor","el":"Επιτεύχθηκε το όριο αιτημάτων ανά λεπτό, σε αναμονή","he":"הושגה מגבלת הבקשות לדקה, ממתין","ar":"تم بلوغ حدّ الطلبات في الدقيقة، في انتظار","fa":"به سقف درخواست‌های دقیقه‌ای رسیده، در حال انتظار","ur":"فی منٹ درخواست حد پہنچ گئی، انتظار میں","hi":"प्रति मिनट सीमा पूरी हो गई, प्रतीक्षा में","bn":"প্রতি মিনিটের সীমায় পৌঁছেছে, অপেক্ষা করছে","ta":"நிமிடத்திற்கான வரம்பை எட்டியது, காத்திருக்கிறது","te":"నిమిషానికి పరిమితిని చేరుకుంది, వేచి ఉంది","kn":"ನಿಮಿಷಕ್ಕಿರುವ ಮಿತಿಯನ್ನು ತಲುಪಿದೆ, ನಿರೀಕ್ಷಿಸುತ್ತಿದೆ","ml":"മിനിറ്റിലെ പരിധിയിൽ എത്തി, കാത്തിരിക്കുന്നു","mr":"प्रति मिनिट मर्यादा गाठली, प्रतीक्षा करत आहे","gu":"પ્રતિ મિનિટ મર્યાદા પૂરી થઈ, રાહ જોઈ રહ્યા છીએ","pa":"ਪ੍ਰਤੀ ਮਿੰਟ ਸੀਮਾ ਪੂਰੀ ਹੋ ਗਈ, ਉਡੀਕ ਵਿੱਚ","ne":"प्रति मिनेट सीमा पुग्यो, प्रतीक्षा गर्दै","or":"ପ୍ରତି ମିନିଟ୍ ସୀମା ପହଞ୍ଚିଗଲା, ଅପେକ୍ଷା କରୁଛି","th":"ถึงขีดจำกัดต่อนาทีแล้ว กำลังรอ","vi":"Đã chạm giới hạn mỗi phút, đang chờ","id":"Mencapai batas permintaan per menit, menunggu","ms":"Mencapai had permintaan seminit, menunggu","tl":"Naabot na ang limitasyon kada minuto, naghihintay","sw":"Kikomo cha kwa dakika kimefikiwa, inasubiri","af":"Perminuutgrens bereik, wag","az":"Dəqiqəlik həddə çatdı, gözləyir","am":"የደቂቃ ገደብ ተደርሷል፣ በመጠበቅ ላይ","zu":"Kufinyelelwe umkhawulo ngemizuzu, kulindele"},"search-no-answer":{"ja":"YouTube Musicが検索に応じませんでした","ko":"YouTube Music이 검색에 응답하지 않았습니다","zh":"YouTube Music 没有响应搜索","zh-hk":"YouTube Music 沒有回應搜尋","zh-tw":"YouTube Music 沒有回應搜尋","es":"YouTube Music no respondió a la búsqueda","pt":"O YouTube Music não respondeu à pesquisa","pt-br":"O YouTube Music não respondeu à busca","fr":"YouTube Music n'a pas répondu à la recherche","de":"YouTube Music hat die Suche nicht beantwortet","it":"YouTube Music non ha risposto alla ricerca","nl":"YouTube Music reageerde niet op de zoekopdracht","ca":"YouTube Music no ha respost a la cerca","gl":"YouTube Music non respondeu á busca","eu":"YouTube Music-ek ez dio erantzun bilaketari","pl":"YouTube Music nie odpowiedział na wyszukiwanie","cs":"YouTube Music neodpověděl na vyhledávání","sk":"YouTube Music neodpovedal na vyhľadávanie","sl":"YouTube Music ni odgovoril na iskanje","hr":"YouTube Music nije odgovorio na pretraživanje","bs":"YouTube Music nije odgovorio na pretraživanje","sr":"YouTube Music није одговорио на претрагу","bg":"YouTube Music не отговори на търсенето","mk":"YouTube Music не одговори на пребарувањето","lt":"YouTube Music neatsakė į paiešką","lv":"YouTube Music neatbildēja uz meklēšanu","et":"YouTube Music ei vastanud otsingule","hu":"A YouTube Music nem válaszolt a keresésre","ro":"YouTube Music nu a răspuns la căutare","da":"YouTube Music svarede ikke på søgningen","nb":"YouTube Music svarte ikke på søket","sv":"YouTube Music svarade inte på sökningen","is":"YouTube Music svaraði ekki leitinni","fi":"YouTube Music ei vastannut hakuun","ru":"YouTube Music не ответил на поисковый запрос","uk":"YouTube Music не відповів на пошуковий запит","tr":"YouTube Music aramaya yanıt vermedi","el":"Το YouTube Music δεν απάντησε στην αναζήτηση","he":"YouTube Music לא השיב לחיפוש","ar":"لم يرد YouTube Music على البحث","fa":"YouTube Music به جست‌وجو پاسخ نداد","ur":"YouTube Music نے تلاش کا جواب نہیں دیا","hi":"YouTube Music ने खोज का जवाब नहीं दिया","bn":"YouTube Music অনুসন্ধানের উত্তর দেয়নি","ta":"YouTube Music தேடலுக்கு பதிலளிக்கவில்லை","te":"YouTube Music శోధనకు స్పందించలేదు","kn":"YouTube Music ಹುಡುಕಾಟಕ್ಕೆ ಪ್ರತಿಕ್ರಿಯಿಸಲಿಲ್ಲ","ml":"YouTube Music തിരച്ചിലിന് മറുപടി നൽകിയില്ല","mr":"YouTube Music ने शोधाला प्रतिसाद दिला नाही","gu":"YouTube Music એ શોધનો જવાબ આપ્યો નથી","pa":"YouTube Music ਨੇ ਖੋਜ ਦਾ ਜਵਾਬ ਨਹੀਂ ਦਿੱਤਾ","ne":"YouTube Music ले खोजको जवाफ दिएन","or":"YouTube Music ଖୋଜକୁ ଉତ୍ତର ଦେଇନାହିଁ","th":"YouTube Music ไม่ตอบสนองการค้นหา","vi":"YouTube Music không phản hồi yêu cầu tìm kiếm","id":"YouTube Music tidak menjawab pencarian","ms":"YouTube Music tidak menjawab carian","tl":"Hindi sumagot ang YouTube Music sa paghahanap","sw":"YouTube Music haikujibu utafutaji","af":"YouTube Music het nie op die soektog gereageer nie","az":"YouTube Music axtarışa cavab vermədi","am":"YouTube Music ፍለጋውን አልመለሰም","zu":"I-YouTube Music ayizange iphendule ukusesha"},"search-refused":{"ja":"YouTube Musicが検索を拒否しました","ko":"YouTube Music이 검색을 거부했습니다","zh":"YouTube Music 拒绝了搜索","zh-hk":"YouTube Music 拒絕了搜尋","zh-tw":"YouTube Music 拒絕了搜尋","es":"YouTube Music rechazó la búsqueda","pt":"O YouTube Music recusou a pesquisa","pt-br":"O YouTube Music recusou a busca","fr":"YouTube Music a refusé la recherche","de":"YouTube Music hat die Suche abgelehnt","it":"YouTube Music ha rifiutato la ricerca","nl":"YouTube Music weigerde de zoekopdracht","ca":"YouTube Music ha rebutjat la cerca","gl":"YouTube Music rexeitou a busca","eu":"YouTube Music-ek bilaketa baztertu du","pl":"YouTube Music odrzucił wyszukiwanie","cs":"YouTube Music odmítl vyhledávání","sk":"YouTube Music odmietol vyhľadávanie","sl":"YouTube Music je zavrnil iskanje","hr":"YouTube Music je odbio pretraživanje","bs":"YouTube Music je odbio pretraživanje","sr":"YouTube Music је одбио претрагу","bg":"YouTube Music отхвърли търсенето","mk":"YouTube Music го одби пребарувањето","lt":"YouTube Music atmetė paiešką","lv":"YouTube Music noraidīja meklēšanu","et":"YouTube Music lükkas otsingu tagasi","hu":"A YouTube Music elutasította a keresést","ro":"YouTube Music a respins căutarea","da":"YouTube Music afviste søgningen","nb":"YouTube Music avviste søket","sv":"YouTube Music avvisade sökningen","is":"YouTube Music hafnaði leitinni","fi":"YouTube Music hylkäsi haun","ru":"YouTube Music отклонил поиск","uk":"YouTube Music відхилив пошуковий запит","tr":"YouTube Music aramayı reddetti","el":"Το YouTube Music απέρριψε την αναζήτηση","he":"YouTube Music דחה את החיפוש","ar":"رفض YouTube Music البحث","fa":"YouTube Music جست‌وجو را رد کرد","ur":"YouTube Music نے تلاش مسترد کر دی","hi":"YouTube Music ने खोज अस्वीकार कर दी","bn":"YouTube Music অনুসন্ধান প্রত্যাখ্যান করেছে","ta":"YouTube Music தேடலை நிராகரித்தது","te":"YouTube Music శోధనను తిరస్కరించింది","kn":"YouTube Music ಹುಡುಕಾಟವನ್ನು ನಿರಾಕರಿಸಿದೆ","ml":"YouTube Music തിരച്ചിൽ നിരസിച്ചു","mr":"YouTube Music ने शोध नाकारला","gu":"YouTube Music એ શોધ નકારી દીધી","pa":"YouTube Music ਨੇ ਖੋਜ ਰੱਦ ਕਰ ਦਿੱਤੀ","ne":"YouTube Music ले खोज अस्वीकार गर्यो","or":"YouTube Music ଖୋଜାକୁ ପ୍ରତ୍ୟାଖ୍ୟାନ କଲା","th":"YouTube Music ปฏิเสธการค้นหา","vi":"YouTube Music đã từ chối yêu cầu tìm kiếm","id":"YouTube Music menolak pencarian","ms":"YouTube Music menolak carian","tl":"Tinanggihan ng YouTube Music ang paghahanap","sw":"YouTube Music imekataa utafutaji","af":"YouTube Music het die soektog geweier","az":"YouTube Music axtarışı rədd etdi","am":"YouTube Music ፍለጋውን አባረዋል","zu":"I-YouTube Music inqabile ukusesha"},"session-failed":{"ja":"匿名セッションを取得できませんでした","ko":"익명 세션을 가져오지 못했습니다","zh":"无法获取匿名会话","zh-hk":"無法取得匿名工作階段","zh-tw":"無法取得匿名工作階段","es":"No se pudo obtener una sesión anónima de YouTube Music","pt":"Não foi possível obter uma sessão anónima do YouTube Music","pt-br":"Não foi possível obter uma sessão anônima do YouTube Music","fr":"Impossible d'obtenir une session anonyme YouTube Music","de":"Anonyme YouTube-Music-Sitzung konnte nicht abgerufen werden","it":"Impossibile ottenere una sessione anonima di YouTube Music","nl":"Kon geen anonieme YouTube Music-sessie ophalen","ca":"No s'ha pogut obtenir una sessió anònima de YouTube Music","gl":"Non se puido obter unha sesión anónima de YouTube Music","eu":"Ezin izan da YouTube Music-eko saio anonimo bat lortu","pl":"Nie udało się uzyskać anonimowej sesji YouTube Music","cs":"Nepodařilo se získat anonymní relaci YouTube Music","sk":"Nepodarilo sa získať anonymnú reláciu YouTube Music","sl":"Ni bilo mogoče pridobiti anonimne seje YouTube Music","hr":"Nije bilo moguće dobiti anonimnu sesiju YouTube Music","bs":"Nije bilo moguće dobiti anonimnu sesiju YouTube Music","sr":"Није било могуће добити анонимну сесију YouTube Music","bg":"Не можа да се получи анонимна сесия на YouTube Music","mk":"Не можеше да се добие анонимна сесија на YouTube Music","lt":"Nepavyko gauti anoniminės YouTube Music sesijos","lv":"Nevarēja iegūt YouTube Music anonīmo sesiju","et":"Anonüümset YouTube Music'i seanssi ei saanud","hu":"Nem sikerült anonim YouTube Music-munkamenetet kapni","ro":"Nu s-a putut obține o sesiune anonimă YouTube Music","da":"Kunne ikke få en anonym YouTube Music-session","nb":"Kunne ikke hente en anonym YouTube Music-økt","sv":"Kunde inte hämta en anonym YouTube Music-session","is":"Tókst ekki að fá nafnlausa YouTube Music-setu","fi":"Anonyymiä YouTube Music -istuntoa ei saatu","ru":"Не удалось получить анонимную сессию YouTube Music","uk":"Не вдалося отримати анонімний сеанс YouTube Music","tr":"Anonim YouTube Music oturumu alınamadı","el":"Δεν ήταν δυνατή η λήψη ανώνυμης συνεδρίας YouTube Music","he":"לא ניתן היה לקבל פגישה אנונימית של YouTube Music","ar":"تعذّر الحصول على جلسة مجهولة لـ YouTube Music","fa":"دریافت نشست ناشناس YouTube Music ممکن نشد","ur":"YouTube Music کا گمنام سیشن حاصل نہیں ہو سکا","hi":"YouTube Music का गुमनाम सेशन प्राप्त नहीं हो सका","bn":"YouTube Music-এর নামহীন সেশন পাওয়া যায়নি","ta":"YouTube Music-இன் அநாமதேய அமர்வைப் பெற முடியவில்லை","te":"YouTube Music యొక్క అనామక సెషన్ పొందడం సాధ్యం కాలేదు","kn":"YouTube Music ನ ಅನಾಮಧೇಯ ಸೆಷನ್ ಪಡೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ","ml":"YouTube Music-ന്റെ പേരില്ലാത്ത സെഷൻ ലഭിച്ചില്ല","mr":"YouTube Music चे निनावी सत्र मिळाले नाही","gu":"YouTube Music નું નામવિહીન સત્ર મેળવી શકાયું નથી","pa":"YouTube Music ਦਾ ਗੁਮਨਾਮ ਸੈਸ਼ਨ ਪ੍ਰਾਪਤ ਨਹੀਂ ਹੋ ਸਕਿਆ","ne":"YouTube Music को गुमनाम सेसन पाउन सकेन","or":"YouTube Music ର ନାମହୀନ ସେସନ୍ ମିଳିଲା ନାହିଁ","th":"ไม่สามารถรับเซสชันไม่ระบุตัวตนของ YouTube Music ได้","vi":"Không thể lấy phiên ẩn danh của YouTube Music","id":"Tidak bisa mendapatkan sesi anonim YouTube Music","ms":"Tidak dapat memperoleh sesi tanpa nama YouTube Music","tl":"Hindi nakakuha ng anonymous na session ng YouTube Music","sw":"Haikupata kipindi kisichojulikana cha YouTube Music","af":"Kon nie 'n anonieme YouTube Music-sessie kry nie","az":"Anonim YouTube Music sessiyası alınmadı","am":"ስም የሌለውን የYouTube Music ክፍለ ጊዜ ማግኘት አልተቻለም","zu":"Ayikwazanga ukuthola isigaba esingaziwa se-YouTube Music"},"audio-failed":{"ja":"音源を取得できません: {0}","ko":"오디오를 가져올 수 없습니다: {0}","zh":"无法获取音频：{0}","zh-hk":"無法取得音訊：{0}","zh-tw":"無法取得音訊：{0}","es":"No se pudo obtener el audio: {0}","pt":"Não foi possível obter o áudio: {0}","pt-br":"Não foi possível obter o áudio: {0}","fr":"Impossible d'obtenir l'audio : {0}","de":"Audio konnte nicht abgerufen werden: {0}","it":"Impossibile ottenere l'audio: {0}","nl":"Kon de audio niet ophalen: {0}","ca":"No s'ha pogut obtenir l'àudio: {0}","gl":"Non se puido obter o son: {0}","eu":"Ezin izan da audioa lortu: {0}","pl":"Nie udało się pobrać dźwięku: {0}","cs":"Nepodařilo se získat zvuk: {0}","sk":"Nepodarilo sa získať zvuk: {0}","sl":"Ni bilo mogoče pridobiti zvoka: {0}","hr":"Nije bilo moguće dohvatiti zvuk: {0}","bs":"Nije bilo moguće dohvatiti zvuk: {0}","sr":"Није било могуће добити звук: {0}","bg":"Не можа да се получи звукът: {0}","mk":"Не можеше да се добие звукот: {0}","lt":"Nepavyko gauti garso: {0}","lv":"Nevarēja iegūt skaņu: {0}","et":"Heli ei saanud: {0}","hu":"A hangot nem sikerült lekérni: {0}","ro":"Nu s-a putut obține sunetul: {0}","da":"Kunne ikke hente lyden: {0}","nb":"Kunne ikke hente lyden: {0}","sv":"Kunde inte hämta ljudet: {0}","is":"Tókst ekki að ná hljóðinu: {0}","fi":"Ääntä ei saatu: {0}","ru":"Не удалось получить аудио: {0}","uk":"Не вдалося отримати аудіо: {0}","tr":"Ses alınamadı: {0}","el":"Δεν ήταν δυνατή η λήψη του ήχου: {0}","he":"לא ניתן היה לקבל את השמע: {0}","ar":"تعذّر الحصول على الصوت: {0}","fa":"دریافت صدا ممکن نشد: {0}","ur":"آڈیو حاصل نہیں ہو سکا: {0}","hi":"ऑडियो प्राप्त नहीं हो सका: {0}","bn":"অডিও পাওয়া যায়নি: {0}","ta":"ஒலியைப் பெற முடியவில்லை: {0}","te":"ఆడియో పొందడం సాధ్యం కాలేదు: {0}","kn":"ಆಡಿಯೊ ಪಡೆಯಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ: {0}","ml":"ഓഡിയോ ലഭിക്കാനായില്ല: {0}","mr":"ऑडिओ मिळवता आला नाही: {0}","gu":"ઑડિયો મેળવી શકાયો નથી: {0}","pa":"ਆਡੀਓ ਪ੍ਰਾਪਤ ਨਹੀਂ ਹੋ ਸਕਿਆ: {0}","ne":"अडियो पाउन सकेन: {0}","or":"ଅଡିଓ ମିଳିଲା ନାହିଁ: {0}","th":"ไม่สามารถรับเสียงได้: {0}","vi":"Không thể lấy âm thanh: {0}","id":"Tidak bisa mendapatkan audio: {0}","ms":"Tidak dapat memperoleh audio: {0}","tl":"Hindi nakuha ang audio: {0}","sw":"Haikupata sauti: {0}","af":"Kon nie die klank kry nie: {0}","az":"Səsi əldə etmək olmadı: {0}","am":"ድምፁን ማግኘት አልተቻለም: {0}","zu":"Ayikwazanga ukuthola umsindo: {0}"},"range-refused":{"ja":"音源の範囲取得が拒否されました (HTTP {0})","ko":"범위 요청이 거부되었습니다 (HTTP {0})","zh":"范围请求被拒绝 (HTTP {0})","zh-hk":"範圍請求被拒絕 (HTTP {0})","zh-tw":"範圍請求被拒絕 (HTTP {0})","es":"Solicitudes de rango rechazadas (HTTP {0})","pt":"Pedidos de intervalo recusados (HTTP {0})","pt-br":"Solicitações de intervalo recusadas (HTTP {0})","fr":"Requêtes de plage refusées (HTTP {0})","de":"Bereichsanfragen abgelehnt (HTTP {0})","it":"Richieste di intervallo rifiutate (HTTP {0})","nl":"Bereikverzoeken geweigerd (HTTP {0})","ca":"Peticions de rang rebutjades (HTTP {0})","gl":"Peticións de rango rexeitadas (HTTP {0})","eu":"Tarte-eskaerak baztertu dira (HTTP {0})","pl":"Żądania zakresu odrzucone (HTTP {0})","cs":"Požadavky na rozsah odmítnuty (HTTP {0})","sk":"Požiadavky na rozsah odmietnuté (HTTP {0})","sl":"Zahteve po obsegu zavrnjene (HTTP {0})","hr":"Zahtjevi za raspon odbijeni (HTTP {0})","bs":"Zahtjevi za raspon odbijeni (HTTP {0})","sr":"Захтеви за опсег одбијени (HTTP {0})","bg":"Заявки за диапазон отхвърлени (HTTP {0})","mk":"Барања за опсег одбиени (HTTP {0})","lt":"Diapazono užklausos atmestos (HTTP {0})","lv":"Diapazona pieprasījumi noraidīti (HTTP {0})","et":"Vahemikipäringud lükati tagasi (HTTP {0})","hu":"Tartománykérések elutasítva (HTTP {0})","ro":"Cererile de interval au fost respinse (HTTP {0})","da":"Intervalforespørgsler afvist (HTTP {0})","nb":"Intervallforespørsler avvist (HTTP {0})","sv":"Intervallförfrågningar avvisade (HTTP {0})","is":"Svæðisbeiðnir hafnaðar (HTTP {0})","fi":"Aluepyynnöt hylättiin (HTTP {0})","ru":"Запросы диапазона отклонены (HTTP {0})","uk":"Запити діапазону відхилено (HTTP {0})","tr":"Aralık istekleri reddedildi (HTTP {0})","el":"Τα αιτήματα εύρους απορρίφθηκαν (HTTP {0})","he":"בקשות טווח נדחו (HTTP {0})","ar":"رُفضت طلبات النطاق (HTTP {0})","fa":"درخواست‌های بازه رد شد (HTTP {0})","ur":"رینج درخواستیں مسترد ہوئیں (HTTP {0})","hi":"रेंज अनुरोध अस्वीकृत (HTTP {0})","bn":"রেঞ্জ অনুরোধ প্রত্যাখ্যাত (HTTP {0})","ta":"வரம்பு கோரிக்கைகள் நிராகரிக்கப்பட்டன (HTTP {0})","te":"శ్రేణి అభ్యర్థనలు తిరస్కరించబడ్డాయి (HTTP {0})","kn":"ಶ್ರೇಣಿ ವಿನಂತಿಗಳು ನಿರಾಕರಿಸಲ್ಪಟ್ಟವು (HTTP {0})","ml":"റേഞ്ച് അഭ്യർത്ഥനകൾ നിരസിക്കപ്പെട്ടു (HTTP {0})","mr":"रेंज विनंत्या नाकारल्या (HTTP {0})","gu":"રેન્જ વિનંતીઓ નકારી લેવાઈ (HTTP {0})","pa":"ਰੇਂਜ ਬੇਨਤੀਆਂ ਰੱਦ ਕੀਤੀਆਂ ਗਈਆਂ (HTTP {0})","ne":"रेन्ज अनुरोध अस्वीकृत (HTTP {0})","or":"ରେଞ୍ଜ ଅନୁରୋଧ ପ୍ରତ୍ୟାଖ୍ୟାନ (HTTP {0})","th":"คำขอช่วงถูกปฏิเสธ (HTTP {0})","vi":"Yêu cầu phạm vi bị từ chối (HTTP {0})","id":"Permintaan rentang ditolak (HTTP {0})","ms":"Permintaan julat ditolak (HTTP {0})","tl":"Tinanggihan ang mga range request (HTTP {0})","sw":"Maombi ya sehemu yamekataliwa (HTTP {0})","af":"Reikversoeke geweier (HTTP {0})","az":"Aralıq sorğuları rədd edildi (HTTP {0})","am":"የክፍል ጥያቄዎች ተከለከሉ (HTTP {0})","zu":"Izicelo zezigaba zenqatshelwe (HTTP {0})"},"audio-verify-failed":{"ja":"音源URLの確認に失敗しました","ko":"오디오 URL을 확인하지 못했습니다","zh":"无法验证音频 URL","zh-hk":"無法驗證音訊 URL","zh-tw":"無法驗證音訊 URL","es":"No se pudo verificar la URL del audio","pt":"Não foi possível verificar o URL do áudio","pt-br":"Não foi possível verificar o URL do áudio","fr":"Impossible de vérifier l'URL de l'audio","de":"Die Audio-URL konnte nicht überprüft werden","it":"Impossibile verificare l'URL dell'audio","nl":"Kon de audio-URL niet verifiëren","ca":"No s'ha pogut verificar l'URL de l'àudio","gl":"Non se puido verificar o URL do son","eu":"Ezin izan da audioaren URLa egiaztatu","pl":"Nie udało się zweryfikować adresu URL dźwięku","cs":"Nepodařilo se ověřit URL zvuku","sk":"Nepodarilo sa overiť URL zvuku","sl":"Ni bilo mogoče preveriti URL-ja zvoka","hr":"Nije bilo moguće provjeriti URL zvuka","bs":"Nije bilo moguće provjeriti URL zvuka","sr":"Није било могуће проверити URL звука","bg":"Не можа да се провери URL адресата на звука","mk":"Не можеше да се потврди URL-то на звукот","lt":"Nepavyko patikrinti garso URL","lv":"Nevarēja pārbaudīt skaņas URL","et":"Heli URL-i ei saanud kinnitada","hu":"A hang URL-jét nem sikerült ellenőrizni","ro":"Nu s-a putut verifica URL-ul sunetului","da":"Kunne ikke bekræfte lydens URL","nb":"Kunne ikke verifisere lyd-URLen","sv":"Kunde inte verifiera ljudets URL","is":"Tókst ekki að sannreyna URL hljóðsins","fi":"Äänen URL:ää ei voitu vahvistaa","ru":"Не удалось проверить URL аудио","uk":"Не вдалося перевірити URL-адресу аудіо","tr":"Ses URL'si doğrulanamadı","el":"Δεν ήταν δυνατή η επαλήθευση της διεύθυνσης URL του ήχου","he":"לא ניתן היה לאמת את כתובת ה-URL של השמע","ar":"تعذّر التحقق من عنوان URL للصوت","fa":"تأیید نشانی اینترنتی صدا ممکن نشد","ur":"آڈیو کا URL تصدیق نہیں ہو سکا","hi":"ऑडियो URL सत्यापित नहीं हो सका","bn":"অডিওর URL যাচাই করা যায়নি","ta":"ஒலியின் URL-ஐ சரிபார்க்க முடியவில்லை","te":"ఆడియో URL ధృవీకరించడం సాధ్యం కాలేదు","kn":"ಆಡಿಯೊ URL ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ","ml":"ഓഡിയോ URL സ്ഥിരീകരിക്കാനായില്ല","mr":"ऑडिओचे URL सत्यापित करता आले नाही","gu":"ઑડિયોનું URL ચકાસી શકાયું નથી","pa":"ਆਡੀਓ ਦਾ URL ਤਸਦੀਕ ਨਹੀਂ ਹੋ ਸਕਿਆ","ne":"अडियो URL प्रमाणित गर्न सकेन","or":"ଅଡିଓ URL ଯାଞ୍ଚ କରାଯାଇପାରିଲା ନାହିଁ","th":"ไม่สามารถตรวจสอบ URL เสียงได้","vi":"Không thể xác minh URL âm thanh","id":"Tidak bisa memverifikasi URL audio","ms":"Tidak dapat mengesahkan URL audio","tl":"Hindi ma-verify ang audio URL","sw":"Haikuweza kuthibitisha URL ya sauti","af":"Kon nie die klank-URL verifieer nie","az":"Səsin URL-si təsdiqlənmədi","am":"የድምፁን URL ማረጋገጥ አልተቻለም","zu":"Ayikwazanga ukuqinisekisa i-URL yomsindo"},"status-skipped":{"ja":"レート制限中のため接続確認を省略しました","ko":"요청 한도에 가까워 상태 확인을 건너뛰었습니다","zh":"接近每分钟上限，已跳过状态检查","zh-hk":"接近每分鐘上限，已略過狀態檢查","zh-tw":"接近每分鐘上限，已略過狀態檢查","es":"Comprobación de estado omitida: cerca del límite por minuto","pt":"Verificação de estado ignorada: perto do limite por minuto","pt-br":"Verificação de status ignorada: perto do limite por minuto","fr":"Vérification d'état ignorée : la limite par minute est proche","de":"Statusprüfung übersprungen: das Minutenlimit ist nahe","it":"Verifica dello stato ignorata: vicino al limite al minuto","nl":"Statuscontrole overgeslagen: het verzoeklimiet per minuut is nabij","ca":"Comprovació d'estat omesa: el límit per minut és a prop","gl":"Comprobación de estado omitida: o límite por minuto está preto","eu":"Egoera-egiaztapena saltatuta: minutuko muga gertu dago","pl":"Pominięto sprawdzanie stanu: blisko limitu na minutę","cs":"Kontrola stavu vynechána: limit za minutu je blízko","sk":"Kontrola stavu vynechaná: limit za minútu je blízko","sl":"Preverjanje stanja preskočeno: omejitev na minuto je blizu","hr":"Provjera stanja preskočena: ograničenje u minuti je blizu","bs":"Provjera stanja preskočena: ograničenje u minuti je blizu","sr":"Провера стања прескочена: ограничење у минуту је близу","bg":"Проверката на състоянието е пропусната: минутният лимит е близо","mk":"Проверката на статусот е прескокната: лимитот во минута е близу","lt":"Būsenos patikrinimas praleistas: minutės riba arti","lv":"Statusa pārbaude izlaista: minūtes robeža ir tuvu","et":"Oleku kontroll jäeti vahele: minutipiir on lähedal","hu":"Állapotellenőrzés kihagyva: a percenkénti korlát közel van","ro":"Verificarea stării a fost omisă: limita pe minut este aproape","da":"Statuskontrol sprunget over: grænsen pr. minut er nær","nb":"Statuskontroll hoppet over: grensen per minutt er nær","sv":"Statuskontroll hoppades över: gränsen per minut är nära","is":"Stöðuskörun sleppt: hámarkið á mínútu er nærri","fi":"Tilan tarkistus ohitettiin: minuuttiraja on lähellä","ru":"Проверка состояния пропущена: близко к минутному лимиту","uk":"Перевірку стану пропущено: близько до хвилинного ліміту","tr":"Durum denetimi atlandı: dakikalık sınıra yaklaşıldı","el":"Ο έλεγχος κατάστασης παραλείφθηκε: το όριο ανά λεπτό είναι κοντά","he":"בדיקת המצב דולגה: מגבלת הבקשות לדקה קרובה","ar":"تخطّي فحص الحالة: الحدّ في الدقيقة قريب","fa":"بررسی وضعیت رد شد: نزدیک سقف درخواست‌های دقیقه‌ای","ur":"صحت کی جانچ چھوڑ دی گئی: فی منٹ حد قریب ہے","hi":"स्थिति जाँच छोड़ी गई: प्रति मिनट सीमा पास है","bn":"অবস্থা পরীক্ষা বাদ দেওয়া হয়েছে: প্রতি মিনিটের সীমার কাছে","ta":"நிலை சோதனை தவிர்க்கப்பட்டது: நிமிட வரம்பு அருகில்","te":"స్థితి తనిఖీ దాటవేయబడింది: నిమిషానికి పరిమితి దగ్గరగా ఉంది","kn":"ಸ್ಥಿತಿ ಪರಿಶೀಲನೆ ಬಿಡಲಾಗಿದೆ: ನಿಮಿಷಕ್ಕಿರುವ ಮಿತಿ ಸಮೀಪದಲ್ಲಿದೆ","ml":"നില പരിശോധന ഒഴിവാക്കി: മിനിറ്റിലെ പരിധി അടുത്തു","mr":"स्थिती तपासणी वगळली: प्रति मिनिट मर्यादा जवळ आहे","gu":"સ્થિતિ તપાસ છોડી દીધી: પ્રતિ મિનિટ મર્યાદા નજીક છે","pa":"ਸਥਿਤੀ ਜਾਂਚ ਛੱਡ ਦਿੱਤੀ ਗਈ: ਪ੍ਰਤੀ ਮਿੰਟ ਸੀਮਾ ਨੇੜੇ ਹੈ","ne":"स्थिति जाँच छोडियो: प्रति मिनेट सीमा नजिकै छ","or":"ସ୍ଥିତି ଯାଞ୍ଚ ଛାଡ଼ି ଦିଆଗଲା: ପ୍ରତି ମିନିଟ୍ ସୀମା ପାଖରେ","th":"ข้ามการตรวจสอบสถานะ: ใกล้ถึงขีดจำกัดต่อนาที","vi":"Đã bỏ qua kiểm tra trạng thái: gần tới giới hạn mỗi phút","id":"Pemeriksaan status dilewati: mendekati batas per menit","ms":"Semakan status dilangkau: hampir dengan had seminit","tl":"Nilaktawan ang pag-check ng status: malapit na ang limitasyon kada minuto","sw":"Ukaguzi wa hali umerukwa: kikomo cha kwa dakika kinakaribia","af":"Statuskontrole oorgeslaan: die perminuutgrens is naby","az":"Vəziyyət yoxlanışı atladı: dəqiqəlik hədd yaxındır","am":"የሁኔታ ፍተሻ ተዝሏል: የደቂቃ ገደብ ቀርቧል","zu":"Ukuhlolwa kwesimo kweqishiwe: umkhawulo ngemizuzu usondelile"},"status-unreachable":{"ja":"YouTube Musicに接続できません (HTTP {0})","ko":"YouTube Music에 연결할 수 없습니다 (HTTP {0})","zh":"无法连接 YouTube Music (HTTP {0})","zh-hk":"無法連線 YouTube Music (HTTP {0})","zh-tw":"無法連線 YouTube Music (HTTP {0})","es":"No se pudo conectar con YouTube Music (HTTP {0})","pt":"Não foi possível contactar o YouTube Music (HTTP {0})","pt-br":"Não foi possível acessar o YouTube Music (HTTP {0})","fr":"Impossible de joindre YouTube Music (HTTP {0})","de":"YouTube Music nicht erreichbar (HTTP {0})","it":"Impossibile raggiungere YouTube Music (HTTP {0})","nl":"Kon YouTube Music niet bereiken (HTTP {0})","ca":"No s'ha pogut accedir a YouTube Music (HTTP {0})","gl":"Non se puido acceder a YouTube Music (HTTP {0})","eu":"Ezin izan da YouTube Music atzitu (HTTP {0})","pl":"Nie udało się połączyć z YouTube Music (HTTP {0})","cs":"Nepodařilo se spojit s YouTube Music (HTTP {0})","sk":"Nepodarilo sa spojiť s YouTube Music (HTTP {0})","sl":"Ni bilo mogoče doseči YouTube Music (HTTP {0})","hr":"Nije bilo moguće doći do YouTube Music (HTTP {0})","bs":"Nije bilo moguće doći do YouTube Music (HTTP {0})","sr":"Није било могуће доћи до YouTube Music (HTTP {0})","bg":"Не можа да се достигне YouTube Music (HTTP {0})","mk":"Не можеше да се стигне до YouTube Music (HTTP {0})","lt":"Nepavyko pasiekti YouTube Music (HTTP {0})","lv":"Nevarēja sasniegt YouTube Music (HTTP {0})","et":"YouTube Music'ini ei jõutud (HTTP {0})","hu":"A YouTube Music nem érhető el (HTTP {0})","ro":"Nu s-a putut accesa YouTube Music (HTTP {0})","da":"Kunne ikke nå YouTube Music (HTTP {0})","nb":"Kunne ikke nå YouTube Music (HTTP {0})","sv":"Kunde inte nå YouTube Music (HTTP {0})","is":"Tókst ekki að ná í YouTube Music (HTTP {0})","fi":"YouTube Musiciin ei saada yhteyttä (HTTP {0})","ru":"Не удалось подключиться к YouTube Music (HTTP {0})","uk":"Не вдалося підключитися до YouTube Music (HTTP {0})","tr":"YouTube Music'a ulaşılamadı (HTTP {0})","el":"Δεν ήταν δυνατή η πρόσβαση στο YouTube Music (HTTP {0})","he":"לא ניתן היה להגיע ל-YouTube Music (HTTP {0})","ar":"تعذّر الوصول إلى YouTube Music (HTTP {0})","fa":"دسترسی به YouTube Music ممکن نشد (HTTP {0})","ur":"YouTube Music تک رسائی ممکن نہیں ہو سکی (HTTP {0})","hi":"YouTube Music तक नहीं पहुँच सके (HTTP {0})","bn":"YouTube Music-এ পৌঁছানো যায়নি (HTTP {0})","ta":"YouTube Music-ஐ அணுக முடியவில்லை (HTTP {0})","te":"YouTube Music చేరుకోవడం సాధ్యం కాలేదు (HTTP {0})","kn":"YouTube Music ತಲುಪಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ (HTTP {0})","ml":"YouTube Music-ലേക്ക് എത്താനായില്ല (HTTP {0})","mr":"YouTube Music पर्यंत पोहोचता आले नाही (HTTP {0})","gu":"YouTube Music સુધી પહોંચી શકાયું નથી (HTTP {0})","pa":"YouTube Music ਤੱਕ ਪਹੁੰਚ ਨਹੀਂ ਹੋ ਸਕੀ (HTTP {0})","ne":"YouTube Music सम्म पुग्न सकेन (HTTP {0})","or":"YouTube Music ପାଖରେ ପହଞ୍ଚିପାରିଲା ନାହିଁ (HTTP {0})","th":"เข้าถึง YouTube Music ไม่ได้ (HTTP {0})","vi":"Không thể truy cập YouTube Music (HTTP {0})","id":"Tidak bisa menghubungi YouTube Music (HTTP {0})","ms":"Tidak dapat menghubungi YouTube Music (HTTP {0})","tl":"Hindi maabot ang YouTube Music (HTTP {0})","sw":"Haikufikia YouTube Music (HTTP {0})","af":"Kon nie YouTube Music bereik nie (HTTP {0})","az":"YouTube Music-a çatmaq olmadı (HTTP {0})","am":"YouTube Music ላይ መድረስ አልተቻለም (HTTP {0})","zu":"Ayikwazanga ukufinyelela ku-YouTube Music (HTTP {0})"},"status-offline":{"ja":"現在YouTube Musicに接続できません","ko":"지금은 YouTube Music에 연결할 수 없습니다","zh":"目前无法连接 YouTube Music","zh-hk":"目前無法連線 YouTube Music","zh-tw":"目前無法連線 YouTube Music","es":"No se puede conectar con YouTube Music ahora mismo","pt":"Não é possível contactar o YouTube Music neste momento","pt-br":"Não é possível acessar o YouTube Music neste momento","fr":"Impossible de joindre YouTube Music pour le moment","de":"YouTube Music ist derzeit nicht erreichbar","it":"Impossibile raggiungere YouTube Music in questo momento","nl":"Kan YouTube Music op dit moment niet bereiken","ca":"Ara mateix no es pot accedir a YouTube Music","gl":"Agora mesmo non se pode acceder a YouTube Music","eu":"Oraintxe ezin da YouTube Music atzitu","pl":"Nie można teraz połączyć się z YouTube Music","cs":"Právě se nelze spojit s YouTube Music","sk":"Práve sa nedá spojiť s YouTube Music","sl":"Trenutno ni mogoče doseči YouTube Music","hr":"Trenutno nije moguće doći do YouTube Music","bs":"Trenutno nije moguće doći do YouTube Music","sr":"Тренутно није могуће доћи до YouTube Music","bg":"В момента не може да се достигне YouTube Music","mk":"Моментално не може да се стигне до YouTube Music","lt":"Šiuo metu nepavyksta pasiekti YouTube Music","lv":"Pašlaik nevar sasniegt YouTube Music","et":"Praegu ei saa YouTube Music'ini jõuda","hu":"A YouTube Music most nem érhető el","ro":"Nu se poate accesa YouTube Music momentan","da":"Kan ikke nå YouTube Music lige nu","nb":"Kan ikke nå YouTube Music akkurat nå","sv":"Kan inte nå YouTube Music just nu","is":"Tekst ekki að ná í YouTube Music eins og er","fi":"YouTube Musiciin ei saa juuri nyt yhteyttä","ru":"Сейчас не удаётся подключиться к YouTube Music","uk":"Наразі не вдається підключитися до YouTube Music","tr":"Şu anda YouTube Music'a ulaşılamıyor","el":"Δεν είναι δυνατή η πρόσβαση στο YouTube Music αυτή τη στιγμή","he":"לא ניתן להגיע ל-YouTube Music כרגע","ar":"لا يمكن الوصول إلى YouTube Music الآن","fa":"در حال حاضر نمی‌توان به YouTube Music دسترسی داشت","ur":"ابھی YouTube Music تک رسائی ممکن نہیں","hi":"अभी YouTube Music तक नहीं पहुँच सकते","bn":"এই মুহূর্তে YouTube Music-এ পৌঁছানো যাচ্ছে না","ta":"தற்போது YouTube Music-ஐ அணுக முடியவில்லை","te":"ప్రస్తుతం YouTube Music చేరుకోవడం సాధ్యం కాదు","kn":"ಈಗ YouTube Music ತಲುಪಲು ಸಾಧ್ಯವಿಲ್ಲ","ml":"ഇപ്പോൾ YouTube Music-ലേക്ക് എത്താനാവില്ല","mr":"सध्या YouTube Music पर्यंत पोहोचता येत नाही","gu":"અત્યારે YouTube Music સુધી પહોંચી શકાતું નથી","pa":"ਇਸ ਸਮੇਂ YouTube Music ਤੱਕ ਪਹੁੰਚ ਨਹੀਂ ਹੋ ਸਕਦੀ","ne":"अहिले YouTube Music सम्म पुग्न सकिँदैन","or":"ବର୍ତ୍ତମାନ YouTube Music ପାଖରେ ପହଞ୍ଚିପାରୁନାହିଁ","th":"ตอนนี้เข้าถึง YouTube Music ไม่ได้","vi":"Hiện không thể truy cập YouTube Music","id":"Saat ini tidak bisa menghubungi YouTube Music","ms":"Buat masa ini tidak dapat menghubungi YouTube Music","tl":"Hindi maabot ang YouTube Music sa ngayon","sw":"Kwa sasa haiwezi kufikia YouTube Music","af":"Kan tans nie YouTube Music bereik nie","az":"İndi YouTube Music-a çatmaq mümkün deyil","am":"አሁን YouTube Music ላይ መድረስ አይቻልም","zu":"Nje ayikwazi ukufinyelela ku-YouTube Music"},"status-error":{"ja":"状態を確認できません: {0}","ko":"상태를 확인할 수 없습니다: {0}","zh":"无法确认状态，按可用显示：{0}","zh-hk":"無法確認狀態，按可用顯示：{0}","zh-tw":"無法確認狀態，按可用顯示：{0}","es":"No se pudo comprobar el estado, se muestra como activo: {0}","pt":"Não foi possível verificar o estado, a mostrar como ativo: {0}","pt-br":"Não foi possível verificar o status, mostrando como ativo: {0}","fr":"Échec de la vérification de l'état, affiché comme actif : {0}","de":"Statusprüfung fehlgeschlagen, wird als aktiv angezeigt: {0}","it":"Verifica dello stato non riuscita, mostrato come attivo: {0}","nl":"Statuscontrole mislukt, wordt als actief getoond: {0}","ca":"La comprovació d'estat ha fallat, es mostra com a actiu: {0}","gl":"A comprobación de estado fallou, móstrase como activo: {0}","eu":"Egoera-egiaztapenak huts egin du, aktibo gisa erakusten: {0}","pl":"Sprawdzenie stanu nie powiodło się, pokazywany jako aktywny: {0}","cs":"Kontrola stavu selhala, zobrazuje se jako aktivní: {0}","sk":"Kontrola stavu zlyhala, zobrazuje sa ako aktívny: {0}","sl":"Preverjanje stanja ni uspelo, prikazuje se kot aktivno: {0}","hr":"Provjera stanja nije uspjela, prikazuje se kao aktivno: {0}","bs":"Provjera stanja nije uspjela, prikazuje se kao aktivno: {0}","sr":"Провера стања није успела, приказује се као активно: {0}","bg":"Проверката на състоянието се провали, показва се като активен: {0}","mk":"Проверката на статусот не успеа, прикажува како активен: {0}","lt":"Būsenos patikrinimas nepavyko, rodoma kaip aktyvi: {0}","lv":"Statusa pārbaude neizdevās, tiek rādīts kā aktīvs: {0}","et":"Oleku kontroll ebaõnnestus, näidatakse aktiivsena: {0}","hu":"Az állapotellenőrzés sikertelen, aktívként jelenik meg: {0}","ro":"Verificarea stării a eșuat, se afișează ca activ: {0}","da":"Statuskontrol mislykkedes, vises som aktiv: {0}","nb":"Statuskontroll mislyktes, vises som aktiv: {0}","sv":"Statuskontroll misslyckades, visas som aktiv: {0}","is":"Stöðuskörun mistókst, birtist sem virk: {0}","fi":"Tilan tarkistus epäonnistui, näkyy aktiivisena: {0}","ru":"Не удалось проверить состояние, показывается как активный: {0}","uk":"Не вдалося перевірити стан, показується як активний: {0}","tr":"Durum denetimi başarısız, etkin gibi gösteriliyor: {0}","el":"Ο έλεγχος κατάστασης απέτυχε, εμφανίζεται ως ενεργό: {0}","he":"בדיקת המצב נכשלה, מוצג כפעיל: {0}","ar":"فشل فحص الحالة، يُعرض على أنه متاح: {0}","fa":"بررسی وضعیت ناموفق بود، فعال نشان داده می‌شود: {0}","ur":"صحت کی جانچ ناکام، فعال کے طور پر دکھایا جا رہا ہے: {0}","hi":"स्थिति जाँच विफल, सक्रिय रूप में दिखा रहे हैं: {0}","bn":"অবস্থা পরীক্ষা ব্যর্থ, সক্রিয় হিসেবে দেখানো হচ্ছে: {0}","ta":"நிலை சோதனை தோல்வி, செயலில் உள்ளதாகக் காட்டப்படுகிறது: {0}","te":"స్థితి తనిఖీ విఫమైంది, క్రియాశీలకంగా చూపుతోంది: {0}","kn":"ಸ್ಥಿತಿ ಪರಿಶೀಲನೆ ವಿಫಲವಾಗಿದೆ, ಸಕ್ರಿಯವಾಗಿ ತೋರಿಸಲಾಗುತ್ತಿದೆ: {0}","ml":"നില പരിശോധന പരാജയപ്പെട്ടു, സജീവമായി കാണിക്കുന്നു: {0}","mr":"स्थिती तपासणी अयशस्वी, सक्रिय म्हणून दाखवत आहे: {0}","gu":"સ્થિતિ તપાસ નિષ્ફળ, સક્રિય તરીકે બતાવી રહ્યા છીએ: {0}","pa":"ਸਥਿਤੀ ਜਾਂਚ ਅਸਫਲ, ਸਰਗਰਮ ਵਜੋਂ ਦਿਖਾਇਆ ਜਾ ਰਿਹਾ ਹੈ: {0}","ne":"स्थिति जाँच असफल, सक्रिय रूपमा देखाइँदै: {0}","or":"ସ୍ଥିତି ଯାଞ୍ଚ ବିଫଳ, ସକ୍ରିୟ ଭାବରେ ଦେଖାଯାଉଛି: {0}","th":"การตรวจสอบสถานะล้มเหลว แสดงเป็นใช้งานได้: {0}","vi":"Kiểm tra trạng thái thất bại, đang hiển thị là hoạt động: {0}","id":"Pemeriksaan status gagal, ditampilkan aktif: {0}","ms":"Semakan status gagal, ditunjukkan sebagai aktif: {0}","tl":"Nabigo ang pag-check ng status, ipinapakita bilang aktibo: {0}","sw":"Ukaguzi wa hali umeshindikana, inaonyeshwa kama hai: {0}","af":"Statuskontrol het misluk, word as aktief gewys: {0}","az":"Vəziyyət yoxlanışı alınmadı, fəal kimi göstərilir: {0}","am":"የሁኔታ ፍተሻ አልተሳካም፣ እንደ ንቁ ይታያል: {0}","zu":"Ukuhlolwa kwesimo kwehlulekile, kubonakala njengokusebenza: {0}"},"research":{"ja":"検索結果に公式楽曲が見つからず、再検索します","ko":"검색 결과에 공식 곡이 없어 다시 검색합니다","zh":"搜索结果中没有官方歌曲，重新搜索","zh-hk":"搜尋結果中沒有官方歌曲，重新搜尋","zh-tw":"搜尋結果中沒有官方歌曲，重新搜尋","es":"Ninguna canción oficial en los resultados, buscando de nuevo","pt":"Nenhuma canção oficial nos resultados, a pesquisar de novo","pt-br":"Nenhuma canção oficial nos resultados, buscando de novo","fr":"Aucune chanson officielle dans les classements, nouvelle recherche","de":"Kein offizieller Song in den Treffern, erneute Suche","it":"Nessun brano ufficiale nei risultati, si cerca di nuovo","nl":"Geen officieel nummer in de resultaten, opnieuw zoeken","ca":"Cap cançó oficial als resultats, es torna a cercar","gl":"Ningunha canción oficial nos resultados, búscase de novo","eu":"Ez dago abesti ofizialik emaitzetan, berriz bilatzen","pl":"Brak oficjalnej piosenki w wynikach, ponowne wyszukiwanie","cs":"Žádná oficiální píseň ve výsledcích, hledá se znovu","sk":"Žiadna oficiálna pieseň vo výsledkoch, hľadá sa znova","sl":"Ni uradne pesmi v rezultatih, iskanje se ponavlja","hr":"Nema službene pjesme u rezultatima, pretraživanje se ponavlja","bs":"Nema službene pjesme u rezultatima, pretraživanje se ponavlja","sr":"Нема званичне песме у резултатима, претрага се понавља","bg":"Няма официална песен в резултатите, ново търсене","mk":"Нема официјална песна во резултатите, повторно барање","lt":"Rezultatuose nėra oficialios dainos, ieškoma dar kartą","lv":"Rezultātos nav oficiālas dziesmas, meklē vēlreiz","et":"Tulemustes pole ametlikku lugu, otsitakse uuesti","hu":"Nincs hivatalos dal a találatok között, újra keres","ro":"Nicio melodie oficială în rezultate, se caută din nou","da":"Ingen officiel sang i resultaterne, søger igen","nb":"Ingen offisiell sang i resultatene, søker på nytt","sv":"Ingen officiell låt i resultaten, söker igen","is":"Engin opinber lag í niðurstöðum, leitar aftur","fi":"Ei virallista kappaletta tuloksissa, haetaan uudelleen","ru":"В результатах нет официальной песни, повторный поиск","uk":"У результатах немає офіційної пісні, повторний пошук","tr":"Sıralamada resmi şarkı yok, yeniden aranıyor","el":"Κανένα επίσημο τραγούδι στα αποτελέσματα, νέα αναζήτηση","he":"אין שיר רשמי בתוצאות, מחפש שוב","ar":"لا توجد أغنية رسمية في النتائج، جارٍ البحث مجددًا","fa":"هیچ آهنگ رسمی در نتایج نیست، دوباره جست‌وجو می‌شود","ur":"نتائج میں کوئی سرکاری گانا نہیں، دوبارہ تلاش","hi":"परिणामों में कोई आधिकारिक गीत नहीं, फिर खोज रहे हैं","bn":"ফলাফলে কোনো অফিসিয়াল গান নেই, আবার অনুসন্ধান করা হচ্ছে","ta":"முடிவுகளில் அதிகாரப்பூர்வ பாடல் இல்லை, மீண்டும் தேடப்படுகிறது","te":"ఫలితాల్లో అధికారిక పాట లేదు, మళ్లీ శోధిస్తోంది","kn":"ಫಲಿತಾಂಶಗಳಲ್ಲಿ ಅಧಿಕೃತ ಹಾಡಿಲ್ಲ, ಮತ್ತೆ ಹುಡುಕಲಾಗುತ್ತಿದೆ","ml":"ഫലങ്ങളിൽ ഔദ്യോഗിക ഗാനമില്ല, വീണ്ടും തിരയുന്നു","mr":"निकालांमध्ये अधिकृत गाणे नाही, पुन्हा शोधत आहे","gu":"પરિણામોમાં કોઈ અધિકૃત ગીત નથી, ફરી શોધી રહ્યા છીએ","pa":"ਨਤੀਜਿਆਂ ਵਿੱਚ ਕੋਈ ਅਧਿਕਾਰਤ ਗੀਤ ਨਹੀਂ, ਦੁਬਾਰਾ ਖੋਜਿਆ ਜਾ ਰਿਹਾ ਹੈ","ne":"नतिजामा कुनै आधिकारिक गीत छैन, फेरि खोजी हुँदै","or":"ଫଳାଫଳରେ କୌଣସି ଅଫିସିଆଲ୍ ଗୀତ ନାହିଁ, ପୁଣି ଖୋଜାଯାଉଛି","th":"ไม่มีเพลงทางการในผลลัพธ์ กำลังค้นหาอีกครั้ง","vi":"Không có bài hát chính thức trong kết quả, đang tìm lại","id":"Tidak ada lagu resmi di hasil, mencari lagi","ms":"Tiada lagu rasmi dalam keputusan, mencari semula","tl":"Walang opisyal na kanta sa resulta, hinahanap muli","sw":"Hakuna wimbo rasmi katika matokeo, inatafuta tena","af":"Geen amptelike liedjie in die uitslae nie, soek weer","az":"Nəticələrdə rəsmi mahnı yoxdur, yenidən axtarılır","am":"በውጤቶቹ ውስጥ ኦፊሴላዊ ዘፈን የለም፣ እንደገና በመፈለግ ላይ","zu":"Ayikho ingoma esemthethweni emiphumeleni, kusesha futhi"},"hook-failed":{"ja":"検索・取得に失敗しました: {0}","ko":"검색 또는 가져오기 실패: {0}","zh":"搜索或获取失败：{0}","zh-hk":"搜尋或取得失敗：{0}","zh-tw":"搜尋或取得失敗：{0}","es":"La búsqueda o la obtención fallaron: {0}","pt":"A pesquisa ou a obtenção falhou: {0}","pt-br":"A busca ou a obtenção falhou: {0}","fr":"Échec de la recherche ou de la récupération : {0}","de":"Suche oder Abruf fehlgeschlagen: {0}","it":"Ricerca o recupero non riusciti: {0}","nl":"Zoeken of ophalen mislukt: {0}","ca":"La cerca o l'obtenció ha fallat: {0}","gl":"A busca ou obtención fallou: {0}","eu":"Bilaketak edo eskuratzeak huts egin du: {0}","pl":"Wyszukiwanie lub pobieranie nie powiodło się: {0}","cs":"Vyhledávání nebo získání selhalo: {0}","sk":"Vyhľadávanie alebo získanie zlyhalo: {0}","sl":"Iskanje ali pridobivanje ni uspelo: {0}","hr":"Pretraživanje ili dohvaćanje nije uspjelo: {0}","bs":"Pretraživanje ili dohvaćanje nije uspjelo: {0}","sr":"Претрага или добављање није успело: {0}","bg":"Търсенето или извличането се провалиха: {0}","mk":"Пребарувањето или добивањето не успеа: {0}","lt":"Paieška ar gavimas nepavyko: {0}","lv":"Meklēšana vai iegūšana neizdevās: {0}","et":"Otsing või hankimine ebaõnnestus: {0}","hu":"A keresés vagy lekérés sikertelen: {0}","ro":"Căutarea sau preluarea a eșuat: {0}","da":"Søgning eller hentning mislykkedes: {0}","nb":"Søk eller henting mislyktes: {0}","sv":"Sökning eller hämtning misslyckades: {0}","is":"Leit eða ná mistókst: {0}","fi":"Haku tai nouto epäonnistui: {0}","ru":"Сбой поиска или получения: {0}","uk":"Збій пошуку чи отримання: {0}","tr":"Arama veya alma başarısız: {0}","el":"Η αναζήτηση ή η λήψη απέτυχε: {0}","he":"החיפוש או האחזור נכשלו: {0}","ar":"فشل البحث أو الجلب: {0}","fa":"جست‌وجو یا دریافت ناموفق بود: {0}","ur":"تلاش یا حاصل کرنا ناکام: {0}","hi":"खोज या प्राप्ति विफल: {0}","bn":"অনুসন্ধান বা আনা ব্যর্থ: {0}","ta":"தேடல் அல்லது பெறுதல் தோல்வி: {0}","te":"శోధన లేదా పొందడం విఫమైంది: {0}","kn":"ಹುಡುಕಾಟ ಅಥವಾ ಪಡೆಯುವಿಕೆ ವಿಫಲ: {0}","ml":"തിരച്ചിലോ ലഭ്യമാക്കലോ പരാജയപ്പെട്ടു: {0}","mr":"शोध किंवा मिळवणे अयशस्वी: {0}","gu":"શોધ કે મેળવવામાં નિષ્ફળતા: {0}","pa":"ਖੋਜ ਜਾਂ ਪ੍ਰਾਪਤੀ ਅਸਫਲ: {0}","ne":"खोज वा प्राप्ति असफल: {0}","or":"ଖୋଜା କିମ୍ବା ଆଣିବା ବିଫଳ: {0}","th":"การค้นหาหรือการดึงข้อมูลล้มเหลว: {0}","vi":"Tìm kiếm hoặc tải về thất bại: {0}","id":"Pencarian atau pengambilan gagal: {0}","ms":"Carian atau pengambilan gagal: {0}","tl":"Nabigo ang paghahanap o pagkuha: {0}","sw":"Utafutaji au upataji umeshindikana: {0}","af":"Soektog of verkryging het misluk: {0}","az":"Axtarış və ya əldə etmə alınmadı: {0}","am":"ፍለጋ ወይም ማግኘት አልተሳካም: {0}","zu":"Ukusesha noma ukuthola kwehlulekile: {0}"},"candidates-not-fetched":{"ja":"一致候補はありましたが、音源を取得できませんでした","ko":"일치하는 후보가 있었지만 오디오를 가져오지 못했습니다","zh":"找到了匹配的候选，但无法获取音频","zh-hk":"找到相符的候選，但無法取得音訊","zh-tw":"找到相符的候選，但無法取得音訊","es":"Se encontraron candidatos coincidentes, pero no se pudo obtener el audio","pt":"Foram encontrados candidatos correspondentes, mas não foi possível obter o áudio","pt-br":"Foram encontrados candidatos correspondentes, mas não foi possível obter o áudio","fr":"Des candidats correspondants ont été trouvés, mais l'audio n'a pas pu être obtenu","de":"Passende Kandidaten gefunden, aber der Audioabruf schlug fehl","it":"Trovati candidati corrispondenti, ma non è stato possibile ottenere l'audio","nl":"Passende kandidaten gevonden, maar de audio kon niet worden opgehaald","ca":"S'han trobat candidats coincidents, però no s'ha pogut obtenir l'àudio","gl":"Atopáronse candidatos coincidentes, mais non se puido obter o son","eu":"Bat datozen hautagaiak aurkitu dira, baina ezin izan da audioa lortu","pl":"Znaleziono pasujących kandydatów, ale nie udało się pobrać dźwięku","cs":"Nalezeni odpovídající kandidáti, ale zvuk se nepodařilo získat","sk":"Našli sa zodpovedajúci kandidáti, ale zvuk sa nepodarilo získať","sl":"Najdeni ustrezni kandidati, zvoka pa ni bilo mogoče pridobiti","hr":"Pronađeni odgovarajući kandidati, ali zvuk nije bilo moguće dohvatiti","bs":"Pronađeni odgovarajući kandidati, ali zvuk nije bilo moguće dohvatiti","sr":"Пронађени одговарајући кандидати, али звук није могао бити добијен","bg":"Намерени са съответстващи кандидати, но звукът не можа да бъде получен","mk":"Пронајдени соодветни кандидати, но звукот не можеше да се добие","lt":"Rasta atitinkamų kandidatų, bet garso gauti nepavyko","lv":"Atrasti atbilstoši kandidāti, bet skaņu nevarēja iegūt","et":"Leiti sobivaid kandidaate, kuid heli ei saanud hankida","hu":"Talált megfelelő jelölteket, de a hangot nem sikerült lekérni","ro":"Au fost găsiți candidați potriviți, dar sunetul nu a putut fi obținut","da":"Fandt matchende kandidater, men kunne ikke hente lyden","nb":"Fant matchende kandidater, men kunne ikke hente lyden","sv":"Hittade matchande kandidater men kunde inte hämta ljudet","is":"Fann samsvarandi frambjóðendur en gat ekki náð hljóðinu","fi":"Sopivia ehdokkaita löytyi, mutta ääntä ei saatu","ru":"Найдены подходящие варианты, но получить аудио не удалось","uk":"Знайдено відповідних кандидатів, але отримати аудіо не вдалося","tr":"Eşleşen adaylar bulundu ama ses alınamadı","el":"Βρέθηκαν ταιριαστοί υποψήφιοι, αλλά δεν ήταν δυνατή η λήψη του ήχου","he":"נמצאו מועמדים תואמים אך לא ניתן היה לאחזר את השמע","ar":"وُجدت مرشحات مطابقة لكن تعذّر جلب الصوت","fa":"نامزدهای منطقی پیدا شد اما دریافت صدا ممکن نشد","ur":"ملتے ہوئے امیدوار ملے لیکن آڈیو حاصل نہیں ہو سکا","hi":"मेल खाते उम्मीदवार मिले लेकिन ऑडियो प्राप्त नहीं हो सका","bn":"মেলে যাওয়া প্রার্থী পাওয়া গেছে কিন্তু অডিও আনা যায়নি","ta":"பொருந்தும் வேட்பாளர்கள் கிடைத்தனர் ஆனால் ஒலியைப் பெற முடியவில்லை","te":"సరిపోయే అభ్యర్థులు దొరికారు కానీ ఆడియో పొందడం సాధ్యం కాలేదు","kn":"ಹೊಂದಾಣಿಕೆಯ ಅಭ್ಯರ್ಥಿಗಳು ದೊರೆತರು ಆದರೆ ಆಡಿಯೊ ಪಡೆಯಲಾಗಲಿಲ್ಲ","ml":"യോജിക്കുന്ന സ്ഥാനാർത്ഥികളെ കണ്ടെത്തിയെങ്കിലും ഓഡിയോ ലഭിച്ചില്ല","mr":"जुळणारे उमेदवार सापडले पण ऑडिओ मिळाला नाही","gu":"મેળ ખાતા ઉમેદવારો મળ્યા પરંતુ ઑડિયો મેળવી શકાયો નથી","pa":"ਮੇਲ ਖਾਂਦੇ ਉਮੀਦਵਾਰ ਮਿਲੇ ਪਰ ਆਡੀਓ ਪ੍ਰਾਪਤ ਨਹੀਂ ਹੋ ਸਕਿਆ","ne":"मिल्ने उम्मेदवार भेटिए तर अडियो पाउन सकिएन","or":"ମେଳ ଖାଉଥିବା ପ୍ରାର୍ଥୀ ମିଳିଲେ କିନ୍ତୁ ଅଡିଓ ମିଳିଲା ନାହିଁ","th":"พบผู้สมัครที่ตรงกันแต่ดึงเสียงไม่สำเร็จ","vi":"Tìm thấy ứng viên khớp nhưng không thể lấy âm thanh","id":"Menemukan kandidat yang cocok tetapi tidak bisa mendapatkan audio","ms":"Menjumpai calon yang sepadan tetapi tidak dapat memperoleh audio","tl":"May natagpuang katugmang kandidato ngunit hindi nakuha ang audio","sw":"Kumepatikana wagombeji wanaofanana lakini sauti haikupatikana","af":"Passende kandidate gevind, maar kon nie die klank kry nie","az":"Uyğun namizədlər tapıldı, lakin səs alınmadı","am":"ተዛማጅ እጩዎች ተገኝተዋል ነገር ግን ድምፁን ማግኘት አልተቻለም","zu":"Kutholakale okufanayo, kodwa i-audio ayitholakalanga"},"not-found":{"ja":"厳密に一致する公式楽曲が見つかりませんでした","ko":"엄격하게 일치하는 공식 곡을 찾지 못했습니다","zh":"没有找到严格匹配的官方歌曲","zh-hk":"沒有找到嚴格相符的官方歌曲","zh-tw":"沒有找到嚴格相符的官方歌曲","es":"No se encontró ninguna canción oficial que coincidiera con certeza","pt":"Nenhuma canção oficial correspondeu com certeza","pt-br":"Nenhuma canção oficial correspondeu com certeza","fr":"Aucune chanson officielle ne correspond avec certitude","de":"Kein offizieller Song passt eindeutig","it":"Nessun brano ufficiale corrisponde con certezza","nl":"Geen officieel nummer kwam onmiskenbaar overeen","ca":"Cap cançó oficial no ha coincidit amb certesa","gl":"Ningunha canción oficial coincidiu con certeza","eu":"Ez dago zalantzarik gabe bat etortzen den abesti ofizialik","pl":"Żadna oficjalna piosenka nie pasowała bez wątpliwości","cs":"Žádná oficiální píseň neodpovídala bez pochybností","sk":"Žiadna oficiálna pieseň nezodpovedala bez pochybností","sl":"Nobena uradna pesem se ni ujela brez dvoma","hr":"Nijedna službena pjesma se nije sigurno podudarila","bs":"Nijedna službena pjesma se nije sigurno podudarila","sr":"Ниједна званична песма се није сигурно подударила","bg":"Няма официална песен, съвпаднала без съмнение","mk":"Нема официјална песна што се совпаѓа без сомнение","lt":"Jokia oficiali daina tikrai neatitiko","lv":"Neviena oficiālā dziesma droši neatbilda","et":"Ükski ametlik lugu ei vastanud kindlalt","hu":"Egyetlen hivatalos dal sem egyezett kétségtelenül","ro":"Nicio melodie oficială nu s-a potrivit fără îndoială","da":"Ingen officiel sang passede ud over tvivl","nb":"Ingen offisiell sang samsvarte uten tvil","sv":"Ingen officiell låt matchade utan tvivel","is":"Ekkert opinbert lag passaði öruggt","fi":"Mikään virallinen kappale ei vastannut varmasti","ru":"Не нашлось официальной песни, совпадающей без сомнений","uk":"Жодна офіційна пісня не збігається без сумнівів","tr":"Kuşkusuz eşleşen resmi bir şarkı bulunamadı","el":"Κανένα επίσημο τραγούδι δεν ταίριαξε με βεβαιότητα","he":"לא נמצא שיר רשמי שמתאים בוודאות","ar":"لم تُوجد أغنية رسمية مطابقة بلا شك","fa":"هیچ آهنگ رسمی با اطمینان مطابقت نداشت","ur":"کوئی سرکاری گانا بلا شک مطابق نہیں ملا","hi":"कोई आधिकारिक गीत निश्चित रूप से मेल नहीं खाया","bn":"নিশ্চিতভাবে মেলে এমন কোনো অফিসিয়াল গান পাওয়া যায়নি","ta":"நிச்சயமாகப் பொருந்தும் அதிகாரப்பூர்வ பாடல் இல்லை","te":"ఖచ్చితంగా సరిపోయే అధికారిక పాట కనబడలేదు","kn":"ಖಚಿತವಾಗಿ ಹೊಂದಾಣಿಕೆಯಾಗುವ ಅಧಿಕೃತ ಹಾಡು ಸಿಗಲಿಲ್ಲ","ml":"സംശയമില്ലാതെ ചേരുന്ന ഔദ്യോഗിക ഗാനം കണ്ടില്ല","mr":"निश्चितपणे जुळणारे अधिकृत गाणे सापडले नाही","gu":"નિશ્ચિતપણે મેળ ખાતું કોઈ અધિકૃત ગીત મળ્યું નથી","pa":"ਨਿਸ਼ਚਿਤ ਤੌਰ 'ਤੇ ਮੇਲ ਖਾਂਦਾ ਕੋਈ ਅਧਿਕਾਰਤ ਗੀਤ ਨਹੀਂ ਮਿਲਿਆ","ne":"निश्चित रूपमा मिल्ने कुनै आधिकारिक गीत भेटिएन","or":"ନିଶ୍ଚିତ ଭାବରେ ମେଳ ଖାଉଥିବା କୌଣସି ଅଫିସିଆଲ୍ ଗୀତ ମିଳିଲା ନାହିଁ","th":"ไม่พบเพลงทางการที่ตรงกันอย่างแน่ชัด","vi":"Không có bài hát chính thức nào khớp một cách chắc chắn","id":"Tidak ada lagu resmi yang cocok dengan pasti","ms":"Tiada lagu rasmi yang sepadan dengan pasti","tl":"Walang opisyal na kantang tugma nang tiyak","sw":"Hakuna wimbo rasmi unaofanana kwa uhakika","af":"Geen amptelike liedjie het onteenseglik gepas nie","az":"Şübhəsiz uyğun gələn rəsmi mahnı tapılmadı","am":"በጥርጣሬ የሌለ ኦፊሴላዊ ዘፈን አልተገኘም","zu":"Ayikho ingoma esemthethweni eyafana ngaphandle kokungabaza"}};
    if (MESSAGES_I18N) {
        Object.keys(MESSAGES_I18N).forEach(function (id) {
            var langs = MESSAGES_I18N[id], target = MESSAGES[id];
            if (!target) return;
            Object.keys(langs).forEach(function (lang) { if (lang !== 'en') target[lang] = langs[lang]; });
        });
    }
    // AndroidのLegacyコード→BCP 47の基言語。
    var LANG_ALIAS = { iw: 'he', in: 'id', fil: 'tl', no: 'nb' };
    // 本体の表示言語をBCP 47風に正規化して小文字化する(ja_JP → ja-jp)。毎回読み直す。
    function localeTag() {
        var tag = '';
        try { tag = String(myspoti.locale || ''); } catch (e) {}
        return tag.replace(/_/g, '-').toLowerCase();
    }
    // {0}の置き換え付き。引数はすべて文字列化し、undefinedは空にする。
    function T(id) {
        var msg = MESSAGES[id], tag = localeTag(), text = '';
        if (!msg) return id;
        if (tag) {
            var base = tag.split('-')[0];
            text = msg[tag] || msg[LANG_ALIAS[base] || base] || '';
        }
        return text || msg.en;
    }
    function TF(id) {
        var text = T(id);
        for (var i = 1; i < arguments.length; i++) {
            text = text.replace(new RegExp('\\{' + (i - 1) + '\\}', 'g'),
                arguments[i] == null ? '' : String(arguments[i]));
        }
        return text;
    }

    // ログにはURL等を出さない。本体のエラーメッセージの形式が変わっても1箇所で直る。
    function scrub(message) {
        return String(message).replace(/https?:\/\/\S+/g, '<address>');
    }

    // 照合の内情。実機ではmyspoti.debugが無いので出ない。PCハーネス(scripts/harness.js)
    // でどのゲートが落としたか・何点で通ったかを見るためのもの。
    function note(message) {
        if (myspoti.debug) myspoti.log(message);
    }

    // 本体は拡張ごとに120リクエスト/分の上限(スライド窓)。連続保存で触れると以後の
    // 検索が全滅するため、自前の台帳で上限到達前に待機する。
    // PCハーネス(myspoti.debugあり)では上限を実質解除し、多数曲の一括照合検証が
    // レート制限で途切れないようにする。
    var LIMIT = myspoti.debug ? 600 : 90, WINDOW_MS = 60000, REQUESTS = [], NOTED = false;
    function balance() {
        var now = Date.now();
        while (REQUESTS.length && now - REQUESTS[0] >= WINDOW_MS) REQUESTS.shift();
        return LIMIT - REQUESTS.length;
    }
    var BUDGET = 'hook budget reached';
    var WAITED = 0;
    // 本体がresults機能(outcome応答)に対応しているか。旧本体にはfeaturesが無い。
    function hasResults() {
        try { return myspoti.features != null && myspoti.features.indexOf('results') >= 0; } catch (e) { return false; }
    }
    // レート制限で答えられないときのoutcome。本体はこの拡張を台帳が空くまで脇に置く
    // (30秒〜15分に丸められる)。曲は「見つからない」ではなく「後で再試行」になる。
    function rateLimited() {
        var wait = REQUESTS.length ? REQUESTS[0] + WINDOW_MS - Date.now() + 200 : 60000;
        return { outcome: 'rate-limited', retryAfterMs: Math.max(30000, Math.min(wait, 900000)) };
    }
    // results対応の本体には投げずにoutcomeで答えるための目印付きエラー。
    function rateLimitedError() {
        var e = new Error(T('rate-limited-throw'));
        e.rateLimited = true;
        return e;
    }
    function sleep(ms) {
        if (!(myspoti.util && typeof myspoti.util.sleep === 'function') || !(ms > 0)) return;
        var step = Math.min(ms, 1800);
        try { myspoti.util.sleep(step); } catch (e) { throw new Error(BUDGET); }
        WAITED += step;
    }
    // フック予算は短い。1回の呼び出しで待機は1分相当まで。
    function govern() {
        // Never wait inside the 15-second audio hook; ask Myspoti to retry later.
        if (balance() <= 0) throw rateLimitedError();
        REQUESTS.push(Date.now());
    }
    function gpost(url, body, opts) {
        govern();
        return myspoti.http.post(url, body, opts);
    }
    function grequest(options) {
        govern();
        return myspoti.http.request(options);
    }

    function normalized(value) {
        var s = String(value || '');
        if (typeof s.normalize === 'function') s = s.normalize('NFKC');
        else {
            s = s.replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); });
            var half = 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
            var full = 'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
            s = s.replace(/[ｦ-ﾝ]/g, function (c) { return full.charAt(half.indexOf(c)); });
            s = s.replace(/([カキクケコサシスセソタチツテトハヒフヘホ])ﾞ/g, function (_, c) { return String.fromCharCode(c.charCodeAt(0) + 1); })
                .replace(/([ハヒフヘホ])ﾟ/g, function (_, c) { return String.fromCharCode(c.charCodeAt(0) + 2); })
                .replace(/ウﾞ/g, 'ヴ').replace(/　/g, ' ');
        }
        // アラビア語の表記ゆれ(ハムザ・マクサ・母音記号)を比較の前に1文字に畳む。
        s = s.replace(/[\u064b-\u0652\u0640]/g, '')
            .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
            .replace(/\u0649/g, '\u064a')
            .replace(/\u0629/g, '\u0647');
        return s.toLowerCase();
    }
    function letters(value) {
        return normalized(value).replace(/[^a-z0-9\u00c0-\u024f\u0370-\u06ff\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0a80-\u0aff\u0b00-\u0b7f\u0b80-\u0bff\u0c00-\u0c7f\u0c80-\u0cff\u0d00-\u0d7f\u0e00-\u0e7f\u0e80-\u0eff\u1000-\u109f\u10a0-\u10ff\u1200-\u137f\u1780-\u17ff\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g, '');
    }
    // 公式側の丸括弧注記(映画・主題歌・OST・アーティスト別名)は情報でない。含む括弧だけ外す。
    var ANNOTATION = /主題曲|主题曲|片尾曲|插曲|電影|电影|電視劇|电视剧|主題歌|映画|劇場版|ドラマ|OST|soundtrack|theme song|韓劇|韩剧/i;
    function stripNotes(s) {
        return s.replace(/[（(【\[][^（(【\[）)】\]]*[）)】\]]/g, function (group) {
            return ANNOTATION.test(group) ? ' ' : group;
        });
    }
    function title(value) {
        var s = stripNotes(normalized(value));
        return letters(s.replace(/\s*(?:\(|\[)?(?:feat|ft)\.?\s+.*/i, '')
            .replace(/\b(official|music|video|audio|lyrics?)\b/gi, ''));
    }
    function artist(value) {
        return letters(stripNotes(normalized(value).replace(CREDITS, ''))
            .replace(/\s*-\s*topic$|vevo$|\s+official(?:\s+(?:channel|music))?$/i, ''));
    }
    function artistNames(track) {
        var list = [track.artist || ''];
        if (Array.isArray(track.artists)) track.artists.forEach(function (a) { list.push(typeof a === 'string' ? a : a.name || ''); });
        var names = [];
        list.forEach(function (a) { a.split(/,|、/).forEach(function (n) { n = artist(n); if (n && names.indexOf(n) < 0) names.push(n); }); });
        return names;
    }
    // 表記から言語を判定。アラビア文字はペルシャ語・ウルドゥー語の固有文字で分け、
    // デーヴァナーガリーはヒンディー語として扱う(マラーティー語等も同じ文字)。
    function languageOf(track) {
        var text = normalized((track.title || '') + ' ' + (track.artist || ''));
        return /[\u3040-\u30ff]/.test(text) ? 'ja' : /[\uac00-\ud7af]/.test(text) ? 'ko' :
            /[\u3400-\u9fff\uf900-\ufaff]/.test(text) ? 'zh' : /[\u0400-\u04ff]/.test(text) ? 'ru' :
            /[\u0370-\u03ff]/.test(text) ? 'el' : /[\u0590-\u05ff]/.test(text) ? 'he' :
            /[\u0530-\u058f]/.test(text) ? 'hy' :
            /[\u067e\u0686\u0698\u06af]/.test(text) ? 'fa' : /[\u0679\u0688\u0691\u06ba\u06be\u06d2]/.test(text) ? 'ur' :
            /[\u0600-\u06ff]/.test(text) ? 'ar' :
            /[\u0980-\u09ff]/.test(text) ? 'bn' : /[\u0a00-\u0a7f]/.test(text) ? 'pa' :
            /[\u0a80-\u0aff]/.test(text) ? 'gu' : /[\u0b80-\u0bff]/.test(text) ? 'ta' :
            /[\u0c00-\u0c7f]/.test(text) ? 'te' : /[\u0c80-\u0cff]/.test(text) ? 'kn' :
            /[\u0d00-\u0d7f]/.test(text) ? 'ml' : /[\u0900-\u097f]/.test(text) ? 'hi' :
            /[\u0e00-\u0e7f]/.test(text) ? 'th' : /[\u0e80-\u0eff]/.test(text) ? 'lo' :
            /[\u1780-\u17ff]/.test(text) ? 'km' : /[\u1000-\u109f]/.test(text) ? 'my' :
            /[\u10a0-\u10ff]/.test(text) ? 'ka' : /[\u1200-\u137f]/.test(text) ? 'am' : 'latin';
    }
    function languages(track) {
        var list = LANG[languageOf(track)], out = [];
        list.concat(['en']).forEach(function (l) { if (out.indexOf(l) < 0) out.push(l); });
        return out;
    }
    function queries(track) {
        var main = String(track.artist || '').split(',')[0].replace(CREDITS, '').trim();
        var name = String(track.title || '').trim();
        var bare = name.replace(/\s*(?:\(|\[)?(?:feat|ft)\.?\s+.*/i, '').trim();
        var words = bare.replace(/[^a-zA-Z0-9\u00c0-\u024f\u0370-\u06ff\u0900-\u097f\u0980-\u09ff\u0a00-\u0a7f\u0a80-\u0aff\u0b00-\u0b7f\u0b80-\u0bff\u0c00-\u0c7f\u0c80-\u0cff\u0d00-\u0d7f\u0e00-\u0e7f\u0e80-\u0eff\u1000-\u109f\u10a0-\u10ff\u1200-\u137f\u1780-\u17ff\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\s]/g, ' ').replace(/\s+/g, ' ').trim();
        var out = [];
        [name + ' ' + main, bare + ' ' + main, words + ' ' + main, bare].forEach(function (q) {
            q = q.trim(); if (q && out.indexOf(q) < 0) out.push(q);
        });
        // ISRC検索で公式曲に当たることは少ない。まず曲名ベースを出し切ってから出す(台帳の節約)。
        if (/^[a-z]{2}[a-z0-9]{3}[0-9]{7}$/i.test(track.isrc || '')) out.push(track.isrc);
        return out;
    }
    function similarity(a, b) {
        // 計算量はO(長さ²)。異常に長い入力でフック予算を食い尽くさないよう打ち切る。
        a = String(a).slice(0, 300); b = String(b).slice(0, 300);
        var row = [0], i, j;
        for (j = 1; j <= b.length; j++) row[j] = j;
        for (i = 0; i < a.length; i++) {
            var next = [i + 1];
            for (j = 0; j < b.length; j++) {
                next[j + 1] = Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a.charAt(i) === b.charAt(j) ? 0 : 1));
            }
            row = next;
        }
        return 1 - row[b.length] / Math.max(a.length, b.length, 1);
    }
    // 窓は本体のダウンロード確認と同じ。公式masterは映像分で少し長い/丸めで短いことがある。
    function sameLength(seconds, track) {
        var diff = seconds * 1000 - track.durationMs;
        return diff >= -5000 && diff <= 15000;
    }
    // 非ラテン字の名前同士は語順の違い(姓+名の順が入れ替わる等)を吸収する:
    // ストア名(4字以上)の各文字が重複込みで相手にすべて含まれれば一致扱いにする。
    function contained(name, other) {
        if (name.length < 4) return false;
        var pool = other, i, at;
        for (i = 0; i < name.length; i++) {
            at = pool.indexOf(name.charAt(i));
            if (at < 0) return false;
            pool = pool.slice(0, at) + pool.slice(at + 1);
        }
        return true;
    }
    function score(hit, track) {
        if (!(track.durationMs > 0) || !sameLength(hit.seconds, track)) {
            note('reject ' + hit.id + ': length ' + hit.seconds + 's vs track ' + Math.round(track.durationMs / 1000) + 's');
            return null;
        }
        // 版違いの語。live/cover等は拒否、リマスター表記は減点(公式masterの表記に
        // 付くことがあるため)。いずれもストアの曲名に同じ語を含む場合は対象外。
        var ownTitle = normalized(track.title);
        var hardExtra = (normalized(hit.title).match(VERSIONS) || []).filter(function (v) { return ownTitle.indexOf(v) < 0; });
        if (hardExtra.length) {
            note('reject ' + hit.id + ': version word ' + hardExtra.join(','));
            return null;
        }
        var remasters = (normalized(hit.title).match(REMASTER) || []).filter(function (v) { return ownTitle.indexOf(v) < 0; }).length;
        // 公式タイトルはSpotifyの表記とずれる(翻訳・リマスター・歌手追加)。近い表記のみ通す。
        // 中国語はストア間の簡体/繁体の字形差があるため、閾値をさらに緩める。
        var wanted = title(track.title), got = title(hit.title);
        if (!wanted || !got) return null;
        var zh = languageOf(track) === 'zh';
        var titleScore = similarity(got, wanted);
        // 公式側は曲名の前に転写(ラテン字)を付けたり、注記を残したりする。曲名が
        // そのまま含まれているなら一致とみなす(逆方向は短い別曲を拾う恐れがあるので見ない)。
        if (wanted.length >= 3 && got.indexOf(wanted) >= 0) titleScore = Math.max(titleScore, 0.9);
        if (titleScore < (zh ? 0.75 : 0.85)) {
            note('reject ' + hit.id + ': title ' + titleScore.toFixed(2) + ' (' + got + ' vs ' + wanted + ')');
            return null;
        }
        var names = artistNames(track), channels = [];
        hit.artists.forEach(function (a) {
            String(a).split(/\s+[/|&]\s+|,|、/).forEach(function (c) {
                c = artist(c);
                if (c && channels.indexOf(c) < 0) channels.push(c);
            });
        });
        if (myspoti.debug) note('score ' + hit.id + ': want[' + names.join('|') + '] got[' + channels.join('|') + ']');
        var artistScore = 0;
        names.forEach(function (n) {
            channels.forEach(function (c) {
                // 包含の最短長。漢字・かな・ハングルは2〜3字の名前が普通なので2字を許し、
                // ラテン字は誤一致(短い語の部分一致)を避けるため4字のまま。
                var min = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(n) ? 2 : 4;
                var foreign = !/^[a-z0-9]*$/.test(n);
                var points = c === n ? 1.0 :
                    Math.min(c.length, n.length) >= min && (c.indexOf(n) >= 0 || n.indexOf(c) >= 0) ? 0.9 :
                    zh && similarity(c, n) >= 0.65 ? 0.9 :
                    foreign && contained(n, c) ? 0.9 :
                    foreign && similarity(c, n) >= 0.85 ? 0.9 : 0;
                if (points > artistScore) artistScore = points;
            });
        });
        if (artistScore < 0.9) {
            note('reject ' + hit.id + ': artist ' + artistScore.toFixed(2));
            return null;
        }
        var timeScore = 1 - Math.abs(hit.seconds * 1000 - track.durationMs) / 10000;
        // アルバム名の一致(spotDLと同じ発想: リマスター/ライブ盤は別アルバムに載る)。
        // 順位決め用で判定の門にはしない(±0.02、既存のしきい値は不変)。
        var albumBonus = 0;
        if (hit.album && track.album) {
            var wantAlbum = title(String(track.album).replace(/\s*-\s*(?:single|ep)\s*$/i, ''));
            var gotAlbum = title(String(hit.album).replace(/\s*-\s*(?:single|ep)\s*$/i, ''));
            if (wantAlbum && gotAlbum) {
                var albumScore = similarity(gotAlbum, wantAlbum);
                if (wantAlbum.length >= 4 && (gotAlbum.indexOf(wantAlbum) >= 0 || wantAlbum.indexOf(gotAlbum) >= 0)) albumScore = Math.max(albumScore, 0.9);
                albumBonus = Math.max(-0.02, Math.min(0.02, (albumScore - 0.6) * 0.05));
            }
        }
        var total = titleScore * 0.6 + artistScore * 0.25 + timeScore * 0.15 + albumBonus - remasters * 0.08;
        if (total < 0) total = 0;
        note('accept ' + hit.id + ': title ' + titleScore.toFixed(2) + ' artist ' + artistScore.toFixed(2) +
            (albumBonus ? ' album ' + (albumBonus >= 0 ? '+' : '') + albumBonus.toFixed(3) : '') +
            (remasters ? ' remaster -' + (remasters * 0.08).toFixed(2) : '') + ' total ' + total.toFixed(2));
        return total;
    }
    function parseSearch(data) {
        var found = {}, hits = [];
        function visit(node, depth) {
            if (!node || typeof node !== 'object' || depth > 14) return; // 深いネストの暴走止め
            var row = node.musicResponsiveListItemRenderer;
            if (row) {
                var columns = row.flexColumns || [];
                function runs(i) { return (((columns[i] || {}).musicResponsiveListItemFlexColumnRenderer || {}).text || {}).runs || []; }
                var first = runs(0)[0] || {};
                var watch = (first.navigationEndpoint || {}).watchEndpoint || {};
                var config = (watch.watchEndpointMusicSupportedConfigs || {}).watchEndpointMusicConfig || {};
                var id = (row.playlistItemData || {}).videoId || watch.videoId || '';
                var names = [], seconds = 0, album = '', meta = runs(1);
                meta.forEach(function (r) {
                    var browse = (r.navigationEndpoint || {}).browseEndpoint || {};
                    var type = ((browse.browseEndpointContextSupportedConfigs || {}).browseEndpointContextMusicConfig || {}).pageType;
                    if (type === 'MUSIC_PAGE_TYPE_ARTIST' && r.text) names.push(r.text);
                    if (type === 'MUSIC_PAGE_TYPE_ALBUM' && r.text) album = r.text;
                    if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(r.text || '')) seconds = r.text.split(':').reduce(function (n, s) { return n * 60 + Number(s); }, 0);
                });
                if (!names.length && meta[0] && !meta[0].navigationEndpoint && meta[0].text && !/[•:]/.test(meta[0].text)) names.push(meta[0].text);
                if (config.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV' && /^[a-zA-Z0-9_-]{11}$/.test(id) && names.length && seconds > 0 && !found[id]) {
                    found[id] = true;
                    hits.push({ id: id, title: runs(0).map(function (r) { return r.text || ''; }).join(''), artists: names, seconds: seconds, album: album });
                }
            }
            Object.keys(node).forEach(function (key) { visit(node[key], depth + 1); });
        }
        visit(data, 0);
        return hits;
    }
    function json(url, body, headers, end) {
        var retried = false, backed = false;
        for (var attempt = 0; attempt < 8; attempt++) {
            var left = end - Date.now();
            if (left < 1200) throw new Error(BUDGET);
            try {
                var response = gpost(url, body, { headers: headers || {}, timeout: Math.min(left - 200, 7000) });
                if (response.ok) return response.json();
                // YouTube側の一時的な障害(5xx)のときだけ、予算内で1回出し直す。
                if (response.status >= 500 && !retried && left > 3000) {
                    retried = true;
                    sleep(600);
                    continue;
                }
                throw new Error('YouTube HTTP ' + response.status);
            } catch (e) {
                var message = String((e && e.message) || e);
                if (message.indexOf('requests in a minute') >= 0) {
                    // 本体の台帳は自分のものより先に満ちる。予算内で待ち、だめなら
                    // 「レート制限中」を投げて本体に再試行させる(見つからない誤登録を防ぐ)。
                    if (WAITED >= 13000 || end - Date.now() < 2500) {
                        throw rateLimitedError();
                    }
                    if (!NOTED) { myspoti.log(T('rate-limited-log')); NOTED = true; }
                    sleep(Math.max(400, Math.min(1800, end - Date.now() - 2500)));
                    continue;
                }
                // 403はYouTube側の一時的なフラグのことも多い。1秒置いて同じ版で1回だけ
                // 出し直す(それでも403なら検索の予備版切替に任せる)。
                if (!backed && /HTTP 403/.test(message) && end - Date.now() > 4000) {
                    backed = true;
                    sleep(1000);
                    continue;
                }
                // 一時的なネットワークの揺らぎ(タイムアウト等)も予算内で1回だけ出し直す。
                if (!retried && end - Date.now() > 3500 && /timeout|timed\s*out|socket|network|econn|reset/i.test(message)) {
                    retried = true;
                    sleep(500);
                    continue;
                }
                throw e;
            }
        }
        throw new Error(T('search-no-answer'));
    }
    function search(query, language, end) {
        var key = language + ':' + query;
        if (cache[key] && Date.now() - cache[key].time < 300000) return cache[key].hits;
        function call() {
            return json(MUSIC, { context: { client: { clientName: 'WEB_REMIX', clientVersion: CLIENT_VERSIONS[CLIENT], hl: language, gl: REGION[language] || 'US' } },
                query: query, params: 'EgWKAQIIAWoKEAkQChAFEAMQBA%3D%3D' }, { Origin: 'https://music.youtube.com' }, end);
        }
        var result;
        try {
            result = call();
        } catch (e) {
            // 版が退役して拒否される(HTTP 400/403)ときだけ、予備の版に切り替えて1回出し直す。
            if (CLIENT + 1 < CLIENT_VERSIONS.length && /HTTP 40[03]/.test(String((e && e.message) || e))) {
                CLIENT++;
                cache = {};
                result = call();
            } else throw e;
        }
        if (result.error) throw new Error(T('search-refused'));
        var hits = parseSearch(result);
        note('search [' + query + '] / ' + language + ' -> ' + hits.length + ' official rows');
        if (Object.keys(cache).length >= 32) cache = {};
        cache[key] = { time: Date.now(), hits: hits };
        return hits;
    }
    function nonce(length) {
        var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-', value = '';
        for (var i = 0; i < length; i++) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
        return value;
    }
    function session(end) {
        // 1時間以内に取得したものは再利用する。落ちたら次の呼び出しで再取得する。
        if (SESSION && Date.now() - SESSION.time < 3600000) return SESSION.value;
        var client = { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1',
            osName: 'visionOS', osVersion: '26.5.23O471', platform: 'MOBILE', hl: 'ja', gl: 'JP', utcOffsetMinutes: 540 };
        var headers = { 'User-Agent': AGENT, 'X-Goog-Api-Format-Version': '2' };
        var visitor = json(API + 'visitor_id?prettyPrint=false', { context: { client: client } }, headers, end);
        var value = (visitor.responseContext || {}).visitorData;
        if (typeof value !== 'string' || !value || value.length > 4096) throw new Error(T('session-failed'));
        client.visitorData = value;
        SESSION = { time: Date.now(), value: { client: client, headers: headers } };
        return SESSION.value;
    }
    // 範囲取得。googlevideoの302転送を追跡し、転送後のURLと応答を返す(206以外ならnull)。
    function probeRange(url, range, end) {
        for (var hop = 0; hop < 4; hop++) {
            if (end - Date.now() < 1200) return null;
            var probe = grequest({ url: url, method: 'GET', headers: { 'User-Agent': AGENT, Range: range },
                timeout: Math.min(5000, end - Date.now() - 200) });
            if (probe.status >= 300 && probe.status < 400 && /^https:\/\//.test(probe.headers['location'] || '')) { url = probe.headers['location']; continue; }
            return probe.status === 206 ? { probe: probe, url: url } : null;
        }
        return null;
    }
    function fileFor(hit, track, end, currentSession) {
        // PCハーネスの照合検証では音源取得が対象外のため、ここで「一致済み」を返す。
        if (myspoti.debug === 'match') return { url: 'debug://match/' + hit.id, format: 'm4a', headers: { 'User-Agent': AGENT }, sizeHint: 0, provider: 'YouTube Music (AAC)', isrcMatched: false };
        var cpn = nonce(16);
        var result = json(API + 'player?prettyPrint=false&id=' + hit.id + '&t=' + nonce(12),
            { context: { client: currentSession.client }, videoId: hit.id, cpn: cpn, contentCheckOk: true, racyCheckOk: true }, currentSession.headers, end);
        var state = result.playabilityStatus || {}, detail = result.videoDetails || {};
        if (state.status !== 'OK') { myspoti.log(TF('audio-failed', state.status || 'UNKNOWN')); return null; }
        if (detail.videoId !== hit.id || detail.isLiveContent || !(Number(detail.lengthSeconds) > 0) || !sameLength(Number(detail.lengthSeconds), track)) return null;
        var streams = ((result.streamingData || {}).adaptiveFormats || []).filter(function (s) {
            return (!s.drmFamilies || !s.drmFamilies.length) && !s.signatureCipher && !s.cipher && /^audio\/mp4\s*;.*mp4a\./.test(s.mimeType || '') &&
                /^https:\/\/[^/?#@\\]+\.googlevideo\.com\/videoplayback\?/.test(s.url || '') &&
                Number(s.contentLength) >= 10000 && Number(s.contentLength) < MAX_SIZE &&
                (!s.audioTrack || s.audioTrack.audioIsDefault !== false);
        }).sort(function (a, b) { return (b.averageBitrate || b.bitrate || 0) - (a.averageBitrate || a.bitrate || 0); });
        for (var i = 0; i < streams.length && end - Date.now() > 2000; i++) {
            var s = streams[i], size = Number(s.contentLength);
            var url = s.url + '&cpn=' + encodeURIComponent(cpn);
            try {
                // 先頭だけ取得できる場合があるため、末尾も確認する。302の転送先も確かめる。
                var head = probeRange(url, 'bytes=0-511', end);
                if (!head) { myspoti.log(TF('range-refused', '3xx')); continue; }
                var tail = probeRange(head.url, 'bytes=' + (size - 512) + '-' + (size - 1), end);
                if (!tail) { myspoti.log(TF('range-refused', '3xx')); continue; }
                var usable = head.probe.headers['content-range'] === 'bytes 0-511/' + size &&
                    tail.probe.headers['content-range'] === 'bytes ' + (size - 512) + '-' + (size - 1) + '/' + size &&
                    /^audio\/(mp4|x-m4a)(;|$)/i.test(head.probe.headers['content-type'] || '');
                // 206でも中身が違う(長さ不一致・音声でない)場合はHTTP番号を出さない。
                if (!usable) { myspoti.log(T('audio-verify-failed')); continue; }
                return { url: head.url, format: 'm4a', headers: { 'User-Agent': AGENT },
                    sizeHint: size, provider: 'YouTube Music (AAC)', isrcMatched: false };
            } catch (e) { myspoti.log(T('audio-verify-failed')); }
        }
        return null;
    }
    myspoti.provide('status', function () {
        // 安価な確認1回(最大3秒)。台帳が温かいうちは省略し、保存の枠を消費しない。
        try {
            if (balance() <= 0) return { live: true, detail: T('status-skipped') };
            REQUESTS.push(Date.now());
            var probe = myspoti.http.get('https://music.youtube.com/', { timeout: 3000 });
            // A redirect means the host answered, not that the API is usable. Myspoti's
            // HTTP client does not follow redirects, so do not disable the source on 3xx.
            if (probe.status >= 300 && probe.status < 400)
                return { live: true, detail: 'HTTP ' + probe.status + ': server raggiunto; prova la riproduzione' };
            return probe.ok ? { live: true } :
                { live: false, detail: TF('status-unreachable', probe.status) };
        } catch (e) {
            var message = String((e && e.message) || e);
            // タイムアウト等、本当に届かないときは正直にlive:falseへ(その曲も失敗するため)。
            if (/timeout|timed\s*out|cannot\s*resolve|unable\s*to\s*resolve|unreachable|no\s*address|econn|enet|etimed|socket|network/i.test(message))
                return { live: false, detail: T('status-offline') };
            // 想定外(本体側の事情など)は不確かさとして扱う(以前のfail-open)。
            return { live: true, detail: TF('status-error', scrub(message)) };
        }
    });
    // Shared resolver. Audio has a 15 s host deadline; downloads get 30 s.
    function resolveTrack(track, budgetMs) {
        if (!track || !track.title || !artistNames(track).length || !(track.durationMs > 0)) return [];
        WAITED = 0; NOTED = false;
        var end = Date.now() + budgetMs, list = queries(track), tried = {}, currentSession = null;
        // 予算を使い切って全候補を見切れていない(見つからないと誤登録しないための目印)。
        var outOfTime = false;
        // ランキングは同一リクエストでも揺れる。1巡目の後、予算が許す限り2巡目を回す。
        try {
            for (var pass = 0; pass < 2; pass++) {
                if (pass === 1) {
                    cache = {};
                    myspoti.log(T('research'));
                    currentSession = null;
                }
                for (var q = 0; q < list.length && end - Date.now() > 2000; q++) {
                    // 言語ごとに順位が入れ替わるため、同一クエリを曲の表記言語→英語の順で回す。
                    var langs = languages(track);
                    for (var l = 0; l < langs.length && end - Date.now() > 2000; l++) {
                        try {
                            var hits = search(list[q], langs[l], end).map(function (hit) { return { hit: hit, score: score(hit, track) }; })
                                .filter(function (x) { return x.score !== null; }).sort(function (a, b) { return b.score - a.score; });
                            for (var h = 0; h < hits.length && end - Date.now() > 2000; h++) {
                                var hit = hits[h].hit;
                                if (tried[hit.id]) continue;
                                tried[hit.id] = true;
                                if (!currentSession) currentSession = session(end);
                                var file = fileFor(hit, track, end, currentSession);
                                if (file) return [file];
                            }
                        } catch (e) {
                            myspoti.log(TF('hook-failed', scrub(e.message || e)));
                            if (e.rateLimited) throw e;
                            if (e.message === BUDGET) { outOfTime = true; pass = 2; l = langs.length; q = list.length; }
                        }
                    }
                }
            }
        } catch (e) {
            // レート制限中: results対応の本体にはoutcomeで答える(旧本体では投げる)。
            if (e.rateLimited && hasResults()) return rateLimited();
            throw e;
        }
        // 台帳が満ちたまま答えを返すときも「レート制限中」を返す(見つからない誤登録を防ぐ)。
        if (balance() <= 0) {
            if (hasResults()) return rateLimited();
            throw new Error(T('rate-limited-throw'));
        }
        // 予算を使い切って検索を終えられなかった曲も、見つからないとは書かない。
        if (outOfTime && hasResults()) return { outcome: 'network', detail: T('search-no-answer') };
        myspoti.log(Object.keys(tried).length ? T('candidates-not-fetched') : T('not-found'));
        return [];
    }
    myspoti.provide('download-source', function (track) {
        return resolveTrack(track, 25000);
    });
    myspoti.provide('audio-source', function (track) {
        var result = resolveTrack(track, 12000);
        if (!result || !Array.isArray(result)) return result;
        if (!result.length) return null;
        var file = result[0];
        return { url: file.url, headers: file.headers, mimeType: 'audio/mp4',
                 durationMs: track.durationMs, codec: 'aac', expiresInMs: 300000 };
    });

    // PC検証用(scripts/harness.js・scripts/check-i18n.js)。本体のRhinoにはmoduleが無いので何もしない。
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { MESSAGES: MESSAGES, locale: localeTag, T: T, TF: TF,
            languageOf: languageOf, languages: languages, queries: queries, score: score };
    }
}());
