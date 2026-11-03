/*
 * Full emoji picker (category tabs + continuous vertical scroll).
 *
 * Knows nothing about reactions: the caller passes
 *   EmojiPicker.create(container, { onSelect(emoji), isSelected(emoji) })
 * and gets { show, refreshSelected, focusFirst, reset } back.
 *
 * Data comes from window.EmojiData (emoji-data.js, bundled, same origin), so
 * the picker works offline and with every CDN blocked.
 *
 * Layout: all categories are rendered at once, each preceded by a sticky
 * section heading. The tab row acts as jump navigation (smooth scroll to
 * section). An IntersectionObserver updates the active tab as the user
 * scrolls. During search the continuous view is replaced by a flat filtered
 * list (no headings). Clearing search restores the scrollable view.
 *
 * Accessibility: tab row = role=tablist with roving tabindex and automatic
 * activation (Left/Right/Home/End); the grid = role=tabpanel labelled by the
 * active tab. Every node is built with createElement / textContent /
 * setAttribute - no innerHTML, no regex over emoji.
 */
(function (root) {
    'use strict';

    if (typeof document === 'undefined') return;

    const PANEL_ID = 'emojiPickerPanel';
    const EDGE = 12; // px of breathing room when a tab is scrolled into view

    /* ---------------------------------------------------------------
       Keyword map for search. Keys are emoji glyphs, values are
       space-separated Polish/English keywords.
    --------------------------------------------------------------- */
    const EMOJI_KEYWORDS = {
      // ── Faces & emotions ──────────────────────────────────────────────
      '😀':'happy smile laugh radość uśmiech',
      '😃':'happy smile big eyes',
      '😄':'happy laugh smile',
      '😁':'grin smile happy',
      '😆':'laugh funny haha',
      '😅':'sweat nervous laugh',
      '🤣':'rofl laugh funny haha',
      '😂':'laugh cry funny haha płakać śmiech',
      '🙂':'smile slight',
      '🙃':'upside flip sarcasm',
      '😉':'wink mrugać',
      '😊':'smile blush happy szczęście',
      '😇':'angel innocent halo',
      '🥰':'love heart adore kochać',
      '😍':'love eyes heart zakochany',
      '🤩':'star eyes wow amazed',
      '😘':'kiss blow całus',
      '😗':'kiss całus',
      '😚':'kiss całus',
      '😙':'kiss smile całus',
      '😋':'yum tasty delicious pyszny',
      '😛':'tongue tease',
      '😜':'wink tongue silly',
      '🤪':'crazy silly zany',
      '😝':'tongue squint',
      '🤑':'money rich pieniądze bogaty',
      '🤗':'hug embrace przytulanie',
      '🤭':'oops secret giggle',
      '🤫':'shush quiet secret cisza',
      '🤔':'think hmm wonder myśleć',
      '🤐':'zip quiet secret milczeć',
      '🤨':'suspicious raised eyebrow',
      '😐':'neutral blank face',
      '😑':'expressionless',
      '😶':'silence no mouth',
      '😏':'smirk sly',
      '😒':'unamused bored',
      '🙄':'eye roll bored',
      '😬':'grimace awkward niezręcznie',
      '🤥':'lie pinocchio kłamstwo',
      '😌':'relieved calm spokój',
      '😔':'sad pensive smutny',
      '😪':'sleepy tired zmęczony',
      '🤤':'drool yummy',
      '😴':'sleep tired sleeping spać zmęczony',
      '😷':'sick mask chory maska',
      '🤒':'sick fever ill chory gorączka',
      '🤕':'hurt injured ból',
      '🤢':'sick nausea green chory',
      '🤮':'vomit sick wymiotować',
      '🤧':'sneeze cold tissue kichać',
      '🥵':'hot sweat gorąco',
      '🥶':'cold freeze zimno',
      '🥴':'dizzy woozy',
      '😵':'dizzy dead spiral',
      '🤯':'mind blown explode',
      '🤠':'cowboy hat kowboj',
      '🥳':'party celebrate celebrate birthday impreza urodziny',
      '😎':'cool sunglasses okulary fajny',
      '🤓':'nerd glasses geek',
      '🧐':'monocle smart investigate',
      '😕':'confused worried',
      '😟':'worried concerned',
      '🙁':'sad frown smutny',
      '☹️':'frown sad smutny',
      '😮':'surprised open mouth zdziwiony',
      '😯':'hushed surprised',
      '😲':'astonished shocked szok',
      '😳':'flushed embarrassed zawstydowany',
      '🥺':'pleading puppy eyes błagać',
      '🥹':'tear moved touched',
      '😦':'frown open mouth',
      '😧':'anguish worried',
      '😨':'fearful scared strach',
      '😰':'anxious sweat stres',
      '😥':'sad relieved',
      '😢':'cry sad tear płakać smutny',
      '😭':'sob cry tears płakać szlochać',
      '😱':'scream scared horror krzyk',
      '😖':'confounded frustrated',
      '😣':'persevere struggling',
      '😞':'disappointed smutny',
      '😓':'sweat hard work',
      '😩':'weary tired',
      '😫':'tired weary zmęczony',
      '🥱':'yawn tired bored ziewać',
      '😤':'triumph huff proud',
      '😡':'angry mad wściekły złość',
      '😠':'angry mad zły',
      '🤬':'curse angry mad wulgarny',
      '😈':'devil evil smiling',
      '👿':'devil angry evil',
      '💀':'skull dead death czaszka śmierć',
      '☠️':'skull crossbones dead',
      '💩':'poop funny kupa',
      '🤡':'clown funny klaun',
      '👹':'ogre monster demon',
      '👺':'goblin red demon',
      '👻':'ghost halloween duch',
      '👽':'alien ufo kosmita',
      '👾':'alien monster game',
      '🤖':'robot android robot',

      // ── Gestures & body ───────────────────────────────────────────────
      '👋':'wave hello bye cześć',
      '🤚':'hand stop stop',
      '✋':'hand raise stop',
      '🖐️':'hand five',
      '👌':'ok perfect fine okej',
      '🤌':'pinch chef kiss italiano',
      '✌️':'peace victory victory pokój',
      '🤞':'fingers crossed luck szczęście',
      '🤟':'love hand rock',
      '🤘':'rock horns metal',
      '🤙':'call shaka hang loose',
      '👈':'point left lewo',
      '👉':'point right prawo',
      '👆':'point up góra',
      '👇':'point down dół',
      '☝️':'point up one',
      '👍':'thumbs up ok good yes dobra tak',
      '👎':'thumbs down bad no nie złe',
      '✊':'fist punch',
      '👊':'punch fist',
      '👏':'clap applause brawa',
      '🙌':'raise hands celebrate hurray',
      '🫶':'heart hands love',
      '🤲':'open hands prayer',
      '🤝':'handshake deal agreement umowa',
      '🙏':'pray thanks please modlić dziękować',
      '💅':'nails painted manicure',
      '💪':'strong muscle flex siła mięśnie',
      '🦵':'leg kick',
      '🦶':'foot kick',
      '👀':'eyes look watch oczy patrzeć',
      '👅':'tongue taste',
      '👄':'lips mouth kiss usta',
      '🫦':'lips bite',

      // ── Hearts & symbols ──────────────────────────────────────────────
      '❤️':'heart love red serce miłość',
      '🧡':'heart orange serce',
      '💛':'heart yellow serce',
      '💚':'heart green serce',
      '💙':'heart blue serce',
      '💜':'heart purple serce',
      '🖤':'heart black serce',
      '🤍':'heart white serce',
      '🤎':'heart brown serce',
      '💔':'broken heart heartbreak złamane serce',
      '❤️‍🔥':'heart fire love passion',
      '💕':'two hearts love',
      '💞':'revolving hearts love',
      '💓':'beating heart',
      '💗':'growing heart',
      '💖':'sparkling heart',
      '💝':'heart ribbon gift',
      '💘':'heart arrow cupid',
      '💟':'heart decoration',
      '💯':'100 perfect score perfect',
      '💥':'boom explosion explode',
      '💫':'dizzy star sparkle',
      '💦':'water sweat drops',
      '💨':'wind dash fast',
      '💬':'chat speech bubble message wiadomość',
      '💭':'thought bubble think myśl',
      '💤':'sleep zzz spać',
      '🔥':'fire hot flame ogień',
      '✨':'sparkle stars magic',
      '🌈':'rainbow tęcza',
      '⭐':'star gwiazdka',
      '🌟':'star shine glow gwiazdka',
      '💎':'diamond gem brylant diament',

      // ── Animals ───────────────────────────────────────────────────────
      '🐵':'monkey małpa',
      '🐒':'monkey małpa',
      '🦍':'gorilla goryl',
      '🐶':'dog puppy pies szczeniak',
      '🐕':'dog pies',
      '🐩':'poodle pudel pies',
      '🐺':'wolf wilk',
      '🦊':'fox lis',
      '🦝':'raccoon szop',
      '🐱':'cat kitty kot kotek',
      '🐈':'cat kot',
      '🦁':'lion lew',
      '🐯':'tiger tygrys',
      '🐆':'leopard gepard',
      '🐴':'horse koń',
      '🦄':'unicorn jednorożec',
      '🦓':'zebra',
      '🦌':'deer jeleń',
      '🐮':'cow krowa',
      '🐷':'pig świnia',
      '🐗':'boar dzik',
      '🐏':'sheep owca',
      '🐑':'sheep lamb owca',
      '🐐':'goat koza',
      '🐪':'camel wielbłąd',
      '🐫':'camel wielbłąd',
      '🦒':'giraffe żyrafa',
      '🐘':'elephant słoń',
      '🦏':'rhino nosorożec',
      '🐭':'mouse mysz',
      '🐰':'rabbit bunny królik',
      '🐇':'rabbit królik',
      '🐿️':'chipmunk wiewiórka',
      '🦔':'hedgehog jeż',
      '🦇':'bat nietoperz',
      '🐻':'bear niedźwiedź miś',
      '🐻‍❄️':'polar bear niedźwiedź polarny',
      '🐨':'koala',
      '🐼':'panda',
      '🦥':'sloth leniwiec',
      '🦦':'otter wydra',
      '🦘':'kangaroo kangur',
      '🐔':'chicken kurczak',
      '🐧':'penguin pingwin',
      '🐦':'bird ptak',
      '🦅':'eagle orzeł',
      '🦆':'duck kaczka',
      '🦉':'owl sowa',
      '🦜':'parrot papuga',
      '🐸':'frog żaba',
      '🐊':'crocodile krokodyl',
      '🐢':'turtle żółw',
      '🐍':'snake wąż',
      '🦈':'shark rekin',
      '🐙':'octopus ośmiornica',
      '🦋':'butterfly motyl',
      '🐛':'caterpillar worm gąsienica',
      '🐜':'ant mrówka',
      '🐝':'bee honey pszczoła miód',
      '🐞':'ladybug biedronka',
      '🕷️':'spider pająk',
      '🌸':'flower blossom kwiat',
      '🌹':'rose róża',
      '🌺':'flower hibiscus kwiat',
      '🌻':'sunflower słonecznik',
      '🌼':'flower daisy kwiat',
      '🌷':'tulip tulipan',
      '🍀':'clover luck koniczyna szczęście',
      '🍁':'maple leaf jesień',
      '🍂':'leaves autumn fall jesień',
      '🍃':'leaves green liście',
      '🌱':'seedling grow plant roślina',
      '🌲':'tree drzewo',
      '🌳':'tree drzewo',
      '🌴':'palm tree palma',
      '🌵':'cactus kaktus',
      '🍄':'mushroom grzyb',

      // ── Food & drink ──────────────────────────────────────────────────
      '🍎':'apple jabłko',
      '🍊':'orange pomarańcza',
      '🍋':'lemon cytryna',
      '🍌':'banana banan',
      '🍍':'pineapple ananas',
      '🍇':'grapes winogrona',
      '🍓':'strawberry truskawka',
      '🫐':'blueberry jagoda',
      '🥝':'kiwi',
      '🍅':'tomato pomidor',
      '🥑':'avocado awokado',
      '🥕':'carrot marchew',
      '🌽':'corn kukurydza',
      '🍆':'eggplant bakłażan',
      '🥦':'broccoli brokuł',
      '🧅':'onion cebula',
      '🧄':'garlic czosnek',
      '🥜':'peanut orzech',
      '🍞':'bread chleb',
      '🥐':'croissant rogalik',
      '🥨':'pretzel precel',
      '🧀':'cheese ser',
      '🥚':'egg jajko',
      '🍳':'frying egg pan jajko',
      '🥓':'bacon boczek',
      '🍗':'chicken drumstick kurczak',
      '🍖':'meat bone mięso',
      '🍔':'burger hamburger',
      '🍟':'fries frytki',
      '🍕':'pizza',
      '🌮':'taco',
      '🌯':'wrap burrito',
      '🥙':'pita kebab',
      '🍜':'noodles ramen makaron',
      '🍣':'sushi',
      '🍱':'bento box',
      '🍛':'curry',
      '🍝':'pasta spaghetti makaron',
      '🍲':'stew pot garnek',
      '🥗':'salad sałatka',
      '🍿':'popcorn',
      '🧆':'falafel',
      '🍦':'ice cream lody',
      '🍧':'shaved ice lody',
      '🍨':'ice cream lody',
      '🍩':'donut pączek',
      '🍪':'cookie ciastko',
      '🎂':'cake birthday urodziny tort',
      '🍰':'cake slice ciasto',
      '🧁':'cupcake muffin babeczka',
      '🍫':'chocolate czekolada',
      '🍬':'candy cukierek',
      '🍭':'lollipop lizak',
      '🍯':'honey miód',
      '🥛':'milk mleko',
      '☕':'coffee kawa',
      '🫖':'tea herbata',
      '🍵':'tea herbata',
      '🍶':'sake',
      '🍾':'champagne szampan',
      '🍷':'wine wino',
      '🍸':'cocktail koktajl',
      '🍹':'tropical drink koktajl',
      '🍺':'beer piwo',
      '🍻':'beers toast piwo na zdrowie',
      '🥂':'champagne toast szampan',
      '🥃':'whiskey glass whisky',
      '🧋':'bubble tea boba',
      '🥤':'drink straw napój',
      '🧃':'juice sok',
      '🧊':'ice lód',

      // ── Travel & places ───────────────────────────────────────────────
      '🚗':'car auto samochód',
      '🚕':'taxi cab taksówka',
      '🚙':'suv car samochód',
      '🚌':'bus autobus',
      '🚎':'trolley bus trolejbus',
      '🚐':'minibus bus',
      '🚑':'ambulance karetka',
      '🚒':'fire truck straż pożarna',
      '🚓':'police car policja',
      '🚚':'truck ciężarówka',
      '🚲':'bicycle bike rower',
      '🛴':'scooter hulajnoga',
      '🛵':'moped skuter',
      '🏍️':'motorcycle motor',
      '✈️':'plane airplane flight lot samolot',
      '🚀':'rocket rakieta',
      '🛸':'ufo flying saucer',
      '🚁':'helicopter helikopter',
      '⛵':'sailboat żaglówka',
      '🚢':'ship boat statek',
      '🏠':'house home dom',
      '🏡':'house garden dom ogród',
      '🏢':'office building biurowiec',
      '🏥':'hospital szpital',
      '🏦':'bank bank',
      '🏨':'hotel',
      '🏪':'store shop sklep',
      '🏫':'school szkoła',
      '🏰':'castle zamek',
      '🗼':'tower wieża eiffla paryż',
      '🗽':'statue liberty nowy jork',
      '🌍':'earth europe africa world świat ziemia',
      '🌎':'earth americas world świat',
      '🌏':'earth asia world świat',
      '🗺️':'map mapa',
      '🏔️':'mountain góra',
      '🌋':'volcano wulkan',
      '🏕️':'camping tent namiot',
      '🏖️':'beach plaża',
      '🏜️':'desert pustynia',
      '🏝️':'island wyspa',
      '🌁':'fog foggy mgła',
      '🌃':'night city noc miasto',
      '🏙️':'city skyline miasto',
      '🌄':'sunrise mountain wschód',
      '🌅':'sunrise sunset zachód wschód',
      '🌆':'city sunset miasto',
      '🌉':'bridge night most noc',

      // ── Weather & nature ──────────────────────────────────────────────
      '☀️':'sun sunny sunshine słońce',
      '🌤️':'sun cloud słońce chmura',
      '⛅':'partly cloudy słońce chmura',
      '🌥️':'cloudy clouds chmury',
      '☁️':'cloud chmura',
      '🌦️':'rain sun deszcz',
      '🌧️':'rain deszcz',
      '⛈️':'storm thunderstorm burza',
      '🌩️':'lightning storm błyskawica',
      '🌨️':'snow snowing śnieg',
      '❄️':'snowflake snow cold śnieg zimno',
      '⛄':'snowman bałwan śnieg',
      '☃️':'snowman bałwan',
      '🌬️':'wind wiatr',
      '🌪️':'tornado twister trąba powietrzna',
      '🌈':'rainbow tęcza',
      '☔':'umbrella rain parasol deszcz',
      '⚡':'lightning bolt electric błyskawica',
      '🔥':'fire hot flame ogień gorąco',
      '💧':'water drop woda',
      '🌊':'wave ocean sea morze fala',
      '🌙':'moon crescent księżyc noc',
      '🌛':'moon face księżyc',
      '🌕':'full moon pełnia księżyca',
      '⭐':'star gwiazdka',
      '🌟':'glowing star świecąca gwiazdka',
      '💫':'dizzy star sparkle gwiazdka',
      '☄️':'comet meteor kometa',
      '🌌':'galaxy milky way galaktyka',

      // ── Activities & sports ───────────────────────────────────────────
      '🎃':'halloween pumpkin dynia',
      '🎄':'christmas tree choinka Boże Narodzenie',
      '🎆':'fireworks fajerwerki',
      '🎇':'sparkler fajerwerki',
      '🎈':'balloon balon',
      '🎉':'party celebrate confetti impreza',
      '🎊':'confetti party impreza',
      '🎀':'ribbon bow wstążka prezent',
      '🎁':'gift present prezent',
      '🎗️':'ribbon awareness wstążka',
      '🏆':'trophy award nagroda trofeum',
      '🥇':'gold first place złoto pierwsze miejsce',
      '🥈':'silver second place srebro',
      '🥉':'bronze third place brąz',
      '🏅':'medal award',
      '⚽':'football soccer piłka nożna',
      '🏀':'basketball koszykówka',
      '🏈':'american football',
      '⚾':'baseball',
      '🎾':'tennis tenis',
      '🏐':'volleyball siatkówka',
      '🏉':'rugby',
      '🎱':'billiards pool bilard',
      '🏓':'ping pong table tennis tenis stołowy',
      '🏸':'badminton',
      '🥊':'boxing glove boks',
      '🥋':'martial arts karate',
      '⛷️':'skiing narciarstwo',
      '🏂':'snowboard',
      '🏊':'swimming pływanie',
      '🚴':'cycling rower',
      '🏋️':'weightlifting siłownia',
      '🤸':'gymnastics gimnastyka',
      '⛳':'golf',
      '🎣':'fishing wędkarstwo',
      '🎯':'target bullseye cel',
      '🎮':'video game gaming gra',
      '🕹️':'joystick game joystick',
      '🎲':'dice game kostka',
      '🧩':'puzzle jigsaw',
      '🎭':'theater theatre teatr',
      '🎨':'art paint sztuka malowanie',
      '🖼️':'picture frame obraz',
      '🎬':'film movie clapper film kino',
      '🎤':'microphone mic mikrofon',
      '🎧':'headphones słuchawki',
      '🎷':'saxophone saksofon',
      '🎸':'guitar gitara',
      '🎹':'piano keyboard pianino',
      '🎺':'trumpet trąbka',
      '🎻':'violin skrzypce',
      '🥁':'drum perkusja',
      '🎵':'music note muzyka',
      '🎶':'music notes muzyka',

      // ── Objects ───────────────────────────────────────────────────────
      '👓':'glasses okulary',
      '🕶️':'sunglasses okulary przeciwsłoneczne',
      '👔':'tie shirt krawat koszula',
      '👕':'shirt tshirt koszulka',
      '👖':'jeans pants spodnie',
      '👗':'dress sukienka',
      '👘':'kimono',
      '👙':'bikini',
      '👒':'hat kapelusz',
      '🎩':'top hat cylinder kapelusz',
      '🎓':'graduation hat mortarboard dyplom',
      '🧢':'baseball cap czapka',
      '👑':'crown king queen korona',
      '💍':'ring engagement pierścionek',
      '💄':'lipstick pomadka',
      '👜':'purse bag torebka',
      '👝':'pouch bag torebka',
      '🎒':'backpack school plecak',
      '👞':'shoe but',
      '👟':'sneaker shoe but',
      '👠':'heel shoe obcas',
      '👢':'boot kozak',
      '📱':'phone mobile telefon komórkowy',
      '📲':'phone call telefon',
      '☎️':'telephone phone telefon',
      '💻':'laptop computer komputer',
      '🖥️':'desktop computer komputer',
      '⌨️':'keyboard klawiatura',
      '🖱️':'mouse myszka',
      '💾':'floppy disk dyskietka',
      '💿':'cd disc płyta',
      '📀':'dvd disc płyta',
      '📷':'camera aparat foto',
      '📸':'camera flash aparat',
      '📹':'video camera kamera',
      '📺':'tv television telewizor',
      '📻':'radio',
      '📟':'pager',
      '🔋':'battery bateria',
      '🔌':'plug cable kabel',
      '💡':'light bulb idea żarówka pomysł',
      '🔦':'flashlight latarka',
      '🕯️':'candle świeca',
      '📔':'notebook notatnik',
      '📕':'closed book książka',
      '📗':'green book książka',
      '📘':'blue book książka',
      '📙':'orange book książka',
      '📚':'books books książki',
      '📖':'open book czytać',
      '📰':'newspaper gazeta',
      '📝':'memo pencil notes notatka',
      '📌':'pushpin pin',
      '📎':'paperclip spinacz',
      '✂️':'scissors nożyczki',
      '🔒':'lock locked zamek',
      '🔓':'unlock open otwarty',
      '🔑':'key klucz',
      '🗝️':'key old klucz',
      '🔨':'hammer młotek',
      '⚒️':'hammer pick',
      '🛠️':'tools narzędzia',
      '🔧':'wrench klucz narzedziowy',
      '🔩':'bolt screw śruba',
      '⚙️':'gear settings ustawienia',
      '🔗':'link chain link łańcuch',
      '💉':'syringe injection strzykawka',
      '💊':'pill medicine tablet lekarstwo',
      '🩺':'stethoscope doctor lekarz',
      '🩹':'bandage plaster',
      '🧴':'lotion bottle krem',
      '🧹':'broom sweep miotła',
      '🧺':'basket koszyk',
      '🧻':'toilet paper papier toaletowy',
      '🧼':'soap mydło',
      '🛒':'shopping cart koszyk zakupy',
      '🚪':'door drzwi',
      '🪑':'chair krzesło',
      '🛏️':'bed łóżko',
      '🛋️':'couch sofa',
      '🚿':'shower prysznic',
      '🛁':'bathtub wanna',
      '🚽':'toilet toaleta',
      '💰':'money bag cash pieniądze',
      '💵':'dollar bill pieniądze',
      '💳':'credit card karta',
      '💸':'flying money pieniądze',
      '📦':'package box paczka',
      '📫':'mailbox skrzynka',
      '📬':'open mailbox skrzynka',
      '✉️':'envelope letter email koperta',
      '📧':'email email',
      '📨':'email incoming',
      '📩':'email outgoing',
      '📢':'loudspeaker megafon',
      '📣':'megaphone megafon',
      '🔔':'bell notification dzwonek powiadomienie',
      '🔕':'bell off wyciszony',
      '⏰':'alarm clock budzik',
      '⌚':'watch zegarek',
      '⏱️':'stopwatch stoper',
      '📅':'calendar kalendarz',
      '📆':'calendar date kalendarz',
      '🔍':'search magnify szukaj',
      '🔎':'search zoom szukaj',
      '🔐':'lock key zamek',
      '🗑️':'trash bin kosz',
      '📊':'chart graph wykres',
      '📈':'chart up wzrost',
      '📉':'chart down spadek',
      '🗂️':'folder files teczka',
      '📁':'folder teczka',
      '📂':'open folder teczka',

      // ── Symbols ───────────────────────────────────────────────────────
      '✅':'check ok done done zrobione',
      '❌':'cross no wrong nie błąd',
      '❓':'question mark pytanie',
      '❗':'exclamation mark wykrzyknik',
      '💲':'dollar sign dolar',
      '♻️':'recycle recycling recykling',
      '🔞':'no under 18 zakaz',
      '⛔':'no entry zakaz',
      '🚫':'prohibited forbidden zakaz',
      '⚠️':'warning caution uwaga ostrzeżenie',
      '🆕':'new nowy',
      '🆓':'free darmowy',
      '🆗':'ok okej',
      '🆙':'up nowy',
      '🔝':'top najlepszy',
      '🔴':'red circle czerwony',
      '🟠':'orange circle pomarańczowy',
      '🟡':'yellow circle żółty',
      '🟢':'green circle zielony',
      '🔵':'blue circle niebieski',
      '🟣':'purple circle fioletowy',
      '⚫':'black circle czarny',
      '⚪':'white circle biały',

      // ── Flags ─────────────────────────────────────────────────────────
      '🇵🇱':'poland polska polska flaga',
      '🇬🇧':'uk england britain wielka brytania',
      '🇺🇸':'usa united states america stany',
      '🇩🇪':'germany niemcy',
      '🇫🇷':'france francja',
      '🇮🇹':'italy włochy',
      '🇪🇸':'spain hiszpania',
      '🇵🇹':'portugal portugalia',
      '🇯🇵':'japan japonia',
      '🇨🇳':'china chiny',
      '🇧🇷':'brazil brazylia',
      '🇺🇦':'ukraine ukraina',
      '🇸🇪':'sweden szwecja',
      '🇳🇴':'norway norwegia',
      '🇨🇿':'czech czechy',
      '🇸🇰':'slovakia słowacja',
      '🏳️‍🌈':'rainbow pride lgbt',
      '🏴‍☠️':'pirate skull skull pirat',
    };

    function create(container, options) {
        const opts = options || {};
        const data = root.EmojiData;
        if (!container || !data || !Array.isArray(data.categories) || data.categories.length === 0) {
            return null;
        }
        const categories = data.categories;
        const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : function () {};
        const isSelected = typeof opts.isSelected === 'function' ? opts.isSelected : function () { return false; };
        const lists = categories.map(category =>
            String(category.emoji || '').split(' ').filter(Boolean));

        // Flat list of all emoji across all categories (for search)
        const allEmoji = lists.reduce(function(acc, list) { return acc.concat(list); }, []);

        let active = 0;        // index of the currently-highlighted tab
        let rove = 0;          // index of the grid button that holds tabindex=0
        let searchQuery = '';  // current search string
        let buttons = [];      // emoji buttons currently in DOM
        const tabEls = [];
        // heading elements (one per category) for scroll-spy
        const headingEls = [];

        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        /* ---- Tab row ---- */
        const tablist = document.createElement('div');
        tablist.className = 'emoji-picker-tabs';
        tablist.setAttribute('role', 'tablist');
        tablist.setAttribute('aria-label', 'Kategorie emoji');

        /* ---- Scrollable grid (holds all categories) ---- */
        const grid = document.createElement('div');
        grid.className = 'emoji-picker-grid';
        grid.id = PANEL_ID;
        grid.setAttribute('role', 'tabpanel');

        /* ---- Search input ---- */
        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'emoji-picker-search';
        searchInput.placeholder = 'Szukaj emoji...';
        searchInput.setAttribute('aria-label', 'Szukaj emoji');
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.setAttribute('autocorrect', 'off');
        searchInput.setAttribute('autocapitalize', 'off');
        searchInput.setAttribute('spellcheck', 'false');

        /* ---- "no results" message node ---- */
        const noResults = document.createElement('p');
        noResults.style.cssText = 'margin:16px 4px;color:#718096;font-size:14px;grid-column:1/-1;';
        noResults.hidden = true;

        /* ---- Build tabs ---- */
        categories.forEach((category, index) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'emoji-picker-tab';
            tab.id = 'emojiPickerTab-' + String(category.id);
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-label', String(category.label));
            tab.setAttribute('aria-controls', PANEL_ID);
            tab.setAttribute('data-index', String(index));
            tab.textContent = String(category.icon);
            tabEls.push(tab);
            tablist.appendChild(tab);
        });

        /* ---- Build the full continuous grid (rendered once) ---- */
        function buildFullGrid() {
            grid.textContent = '';
            headingEls.length = 0;
            buttons = [];

            categories.forEach((category, catIndex) => {
                // Sticky section heading
                const heading = document.createElement('div');
                heading.className = 'emoji-picker-section-heading';
                heading.textContent = String(category.label);
                heading.setAttribute('data-category-index', String(catIndex));
                headingEls.push(heading);
                grid.appendChild(heading);

                // Emoji buttons for this category
                lists[catIndex].forEach((emoji, emojiIndex) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'emoji-picker-btn';
                    button.setAttribute('data-emoji', emoji);
                    button.setAttribute('data-cat-index', String(catIndex));
                    button.setAttribute('aria-pressed', isSelected(emoji) ? 'true' : 'false');
                    button.tabIndex = (catIndex === 0 && emojiIndex === 0) ? 0 : -1;
                    button.textContent = emoji;
                    buttons.push(button);
                    grid.appendChild(button);
                });
            });

            rove = 0;
            grid.appendChild(noResults);
        }

        /* ---- IntersectionObserver: update active tab as sections scroll ---- */
        let observer = null;
        let scrollJumping = false; // suppress observer during programmatic scroll

        function setupObserver() {
            if (observer) observer.disconnect();
            // Observe each heading; when a heading enters the top portion of
            // the grid viewport, mark its category as active.
            observer = new IntersectionObserver(function (entries) {
                if (scrollJumping) return;
                // Find the topmost visible heading
                let topmost = null;
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        if (topmost === null ||
                            entry.boundingClientRect.top < topmost.boundingClientRect.top) {
                            topmost = entry;
                        }
                    }
                });
                if (topmost) {
                    const idx = Number(topmost.target.getAttribute('data-category-index'));
                    if (idx !== active) {
                        active = idx;
                        paintTabs();
                        revealTab(tabEls[active]);
                    }
                }
            }, {
                root: grid,
                // Fire when heading is within the top 20% of the grid container
                rootMargin: '0px 0px -80% 0px',
                threshold: 0
            });

            headingEls.forEach(function (h) { observer.observe(h); });
        }

        /* ---- Assemble container ---- */
        container.textContent = '';
        container.appendChild(searchInput);
        container.appendChild(tablist);
        container.appendChild(grid);

        /* ---- Paint helpers ---- */
        function paintTabs() {
            tabEls.forEach((tab, index) => {
                const on = index === active;
                tab.setAttribute('aria-selected', on ? 'true' : 'false');
                tab.tabIndex = on ? 0 : -1;
            });
        }

        function revealTab(tab) {
            const left = tab.offsetLeft;
            const right = left + tab.offsetWidth;
            if (left < tablist.scrollLeft) {
                tablist.scrollLeft = Math.max(0, left - EDGE);
            } else if (right > tablist.scrollLeft + tablist.clientWidth) {
                tablist.scrollLeft = right - tablist.clientWidth + EDGE;
            }
        }

        /* ---- Search: show flat filtered results ---- */
        function paintSearchResults(query) {
            // Hide section headings during search
            headingEls.forEach(h => { h.hidden = true; });
            noResults.hidden = true;

            const filtered = allEmoji.filter(function (emoji) {
                const kw = EMOJI_KEYWORDS[emoji];
                if (kw && kw.includes(query)) return true;
                // Also try category label
                const catIdx = categories.findIndex(function (_, ci) {
                    return lists[ci].indexOf(emoji) !== -1;
                });
                if (catIdx !== -1 && categories[catIdx].label.toLowerCase().includes(query)) return true;
                // Direct emoji character match (user pasted an emoji)
                if (emoji === query) return true;
                return false;
            });

            // Hide all buttons
            buttons.forEach(b => { b.hidden = true; });

            if (filtered.length === 0) {
                noResults.textContent = 'Brak wyników dla \'' + query + '\'';
                noResults.hidden = false;
                return;
            }

            // Show only matched buttons (reuse existing nodes to avoid rebuild)
            const emojiToButton = {};
            buttons.forEach(function (b) {
                const emoji = b.getAttribute('data-emoji');
                // There could be duplicates; keep first occurrence
                if (!emojiToButton[emoji]) emojiToButton[emoji] = b;
            });

            rove = -1;
            filtered.forEach(function (emoji, i) {
                const btn = emojiToButton[emoji];
                if (!btn) return;
                btn.hidden = false;
                btn.tabIndex = (i === 0) ? 0 : -1;
                if (i === 0) rove = buttons.indexOf(btn);
            });
        }

        /* ---- Restore full continuous view ---- */
        function paintFullView() {
            headingEls.forEach(h => { h.hidden = false; });
            buttons.forEach((b, i) => {
                b.hidden = false;
                b.tabIndex = (i === 0) ? 0 : -1;
            });
            noResults.hidden = true;
            rove = 0;
            grid.setAttribute('aria-labelledby', tabEls[active].id);
            grid.removeAttribute('aria-label');
            grid.removeAttribute('data-search-active');
            grid.scrollTop = 0;
        }

        /* ---- Jump to category section (tab click) ---- */
        function jumpToCategory(index) {
            active = index;
            paintTabs();
            revealTab(tabEls[index]);

            const heading = headingEls[index];
            if (!heading) return;

            scrollJumping = true;
            heading.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
            // Re-enable observer after scroll settles (~500 ms)
            setTimeout(function () { scrollJumping = false; }, 600);
        }

        function moveTo(index) {
            const visibleButtons = buttons.filter(b => !b.hidden);
            if (visibleButtons.length === 0) return;
            const next = Math.max(0, Math.min(visibleButtons.length - 1, index));
            if (rove >= 0 && buttons[rove]) buttons[rove].tabIndex = -1;
            const targetBtn = visibleButtons[next];
            const targetIdx = buttons.indexOf(targetBtn);
            rove = targetIdx;
            targetBtn.tabIndex = 0;
            targetBtn.focus();
        }

        function columns() {
            const visibleButtons = buttons.filter(b => !b.hidden);
            if (visibleButtons.length === 0) return 1;
            const top = visibleButtons[0].offsetTop;
            let count = 0;
            while (count < visibleButtons.length && visibleButtons[count].offsetTop === top) count++;
            return Math.max(1, count);
        }

        /* ---- Event listeners ---- */
        tablist.addEventListener('click', (e) => {
            if (!(e.target instanceof Element)) return;
            const tab = e.target.closest('.emoji-picker-tab');
            if (!tab) return;
            const index = Number(tab.getAttribute('data-index'));
            if (searchQuery.length > 0) {
                // Clear search first, then jump
                searchQuery = '';
                searchInput.value = '';
                paintFullView();
                setupObserver();
            }
            jumpToCategory(index);
        });

        tablist.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const current = tabEls.indexOf(document.activeElement);
            if (current === -1) return;
            let next = -1;
            if (e.key === 'ArrowRight') next = (current + 1) % tabEls.length;
            else if (e.key === 'ArrowLeft') next = (current - 1 + tabEls.length) % tabEls.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = tabEls.length - 1;
            if (next === -1) return;
            e.preventDefault();
            if (searchQuery.length > 0) {
                searchQuery = '';
                searchInput.value = '';
                paintFullView();
                setupObserver();
            }
            jumpToCategory(next);
            tabEls[next].focus();
        });

        grid.addEventListener('click', (e) => {
            if (!(e.target instanceof Element)) return;
            const button = e.target.closest('.emoji-picker-btn');
            if (!button) return;
            onSelect(button.getAttribute('data-emoji'));
        });

        grid.addEventListener('keydown', (e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            const visibleButtons = buttons.filter(b => !b.hidden);
            const current = visibleButtons.indexOf(document.activeElement);
            if (current === -1) return;
            const last = visibleButtons.length - 1;
            let next = -1;
            if (e.key === 'ArrowRight') next = current + 1;
            else if (e.key === 'ArrowLeft') next = current - 1;
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const cols = columns();
                if (e.key === 'ArrowDown') {
                    next = current + cols;
                    if (next > last) next = Math.floor(current / cols) < Math.floor(last / cols) ? last : current;
                } else {
                    next = current - cols;
                    if (next < 0) next = current;
                }
            } else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = last;
            if (next === -1) return;
            e.preventDefault();
            moveTo(next);
        });

        searchInput.addEventListener('input', function () {
            searchQuery = searchInput.value.toLowerCase().trim();
            rove = 0;
            if (searchQuery.length > 0) {
                // Disconnect observer during search; it only applies to full view
                if (observer) observer.disconnect();
                tablist.hidden = true;
                grid.removeAttribute('aria-labelledby');
                grid.setAttribute('aria-label', 'Wyniki wyszukiwania');
                grid.setAttribute('data-search-active', 'true');
                paintSearchResults(searchQuery);
                grid.scrollTop = 0;
            } else {
                tablist.hidden = false;
                paintFullView();
                setupObserver();
            }
        });

        /* ---- Initial render ---- */
        buildFullGrid();
        paintTabs();

        // Set up observer after a microtask so the grid is in the DOM
        setTimeout(setupObserver, 0);

        return {
            // Makes sure tabs and grid reflect the current selection state.
            show: function () {
                // Always clear any leftover search state so the picker
                // opens clean if the user previously searched and closed it
                if (searchQuery) {
                    searchQuery = '';
                    searchInput.value = '';
                    tablist.hidden = false;
                    paintFullView();
                    active = 0;
                    paintTabs();
                    tablist.scrollLeft = 0;
                    grid.scrollTop = 0;
                }
                paintTabs();
                this.refreshSelected();
                revealTab(tabEls[active]);
                searchInput.focus();
                // Re-attach observer (sheet may have been hidden + re-shown)
                setTimeout(setupObserver, 0);
            },
            // Only flips aria-pressed - never rebuilds nodes or moves focus,
            // so a poll-driven repaint cannot steal the user's place.
            refreshSelected: function () {
                buttons.forEach(button => {
                    button.setAttribute('aria-pressed',
                        isSelected(button.getAttribute('data-emoji')) ? 'true' : 'false');
                });
            },
            // Focus lands on the first visible emoji button.
            focusFirst: function () {
                moveTo(0);
            },
            // Back to the first category, scrolled to the top.
            reset: function () {
                searchQuery = '';
                searchInput.value = '';
                tablist.hidden = false;
                paintFullView();
                active = 0;
                paintTabs();
                tablist.scrollLeft = 0;
                grid.scrollTop = 0;
                setTimeout(setupObserver, 0);
            }
        };
    }

    root.EmojiPicker = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
