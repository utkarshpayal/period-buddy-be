/**
 * The Sexual Wellbeing couples card games (18+ in the app), served by
 * `GET /api/wellbeing/games`. `spark` cards are plain strings (questions to
 * talk about; older app builds read them as strings, so keep that shape).
 * `positions` cards are `{ name, focus, tip }`: gentle, non-explicit comfort
 * ideas, many for period or tired days. Keep everything consent-first and
 * free of medical claims; a card's index is its identity for `/draw`, so add
 * new cards at the end rather than reordering.
 */
export const wellbeingDecks = {
  spark: [
    // Connection
    'What is one small, non-physical gesture that makes you feel loved or secure?',
    'What couple habit would feel supportive during your next cycle?',
    'What boundary do you want to discuss around intimacy during heavy flow days?',
    'What helps you feel emotionally safe when your body is uncomfortable?',
    'When did you last feel really seen by me? What did I do?',
    'What is something you wish I asked you about more often?',
    'Which of my habits secretly makes your day better?',
    'What does a perfect lazy Sunday together look like to you?',
    'What is one thing you would like us to do more of this month?',
    'How do you most like to be comforted after a hard day: words, touch, space or a plan?',
    'What is a compliment from me that stayed with you?',
    'What makes you feel most like a team?',
    // Memories
    'What was your very first impression of me, honestly?',
    'Which date of ours would you happily repeat tomorrow?',
    'What is a tiny moment between us that you still think about?',
    'When did you first realise you really liked me?',
    'What is the funniest thing that has happened to us together?',
    'Which song instantly reminds you of us?',
    'What is a trip or outing of ours you would love to relive?',
    // Fun
    'If we swapped lives for a day, what would you do first?',
    'What would our couple name be if we were a celebrity pair?',
    'Which movie couple are we most like, and why?',
    'If we opened a tiny café together, what would be on the menu?',
    'What is a silly tradition we should start?',
    'Describe our relationship using only three emojis.',
    'What is something new you would love to learn together?',
    'If we had a whole free day with no phones, how would you spend it?',
    // Dreams and future
    'Where do you see us on a random Tuesday five years from now?',
    'What is a dream you have not told many people about?',
    'What does a cosy home feel like to you?',
    'What is one adventure you want us to have before the year ends?',
    'What kind of support would help you most with your goals right now?',
    'What is something you want us to get better at together?',
    // Cycle-aware care
    'What helps you most on the first day of your period?',
    'Which snack, drink or comfort item should I always keep ready for crampy days?',
    'How can I tell when you want company and when you want space?',
    'What is one thing about your cycle you wish more partners understood?',
    'How does your energy change across the month, and how can I plan around it?',
    'What is a kind thing I can do on days your mood feels low?',
    'Would a heat pad, a massage or just a quiet cuddle help most on hard days?',
    'How do you like to talk about periods: openly, lightly, or only when you bring it up?',
    // Consent and communication
    'What does a clear, happy yes look like for you?',
    'How can we make it easy for either of us to pause or say no?',
    'Is there a word or signal you would like us to use to slow down?',
    'What helps you feel relaxed enough to say what you want?',
    'How do you like to check in during closeness: words, a look, or a squeeze of the hand?',
    'What is something that should always be talked about first, not assumed?',
    'How should we talk about protection and contraception so it feels normal, not awkward?',
    'What would make you feel safe trying something new together?',
    // Intimacy and closeness
    'What makes you feel most desired, in or out of the bedroom?',
    'Which kind of touch do you find most relaxing?',
    'What is your favourite way to spend the time just before sleep together?',
    'When do you feel closest to me: talking, laughing, or being quiet together?',
    'What sets the mood for you: a tidy room, music, candles, or something else?',
    'What is one thing that makes intimacy feel more comfortable for you?',
    'Is there anything you would like more of, or less of, when we are close?',
    'What does aftercare mean to you: a cuddle, a chat, water, or some space?',
    'How has what you enjoy changed since we first got together?',
    'What is a sweet, slow way you would like to spend an evening together?',
  ],
  positions: [
    {
      name: 'Mission Comfort',
      focus: 'Comfort, closeness, and lower pressure',
      tip: 'Use a soft pillow under the hips if it reduces pelvic pressure. Pause or change position if anything feels uncomfortable.',
    },
    {
      name: 'Lotus Variant',
      focus: 'Closeness and easy pacing',
      tip: 'A relaxed seated posture can make pacing easier and lets either partner slow down whenever needed.',
    },
    {
      name: 'Side Spoon Wrap',
      focus: 'Low pressure and low effort',
      tip: 'Side-lying can feel easier on crampy or tired days because it reduces pressure and body weight.',
    },
    {
      name: 'Pillow Nest',
      focus: 'Support for sore backs',
      tip: 'Stack pillows behind the back and under the knees so nobody is holding their own weight. Comfort first, everything else second.',
    },
    {
      name: 'Face to Face Side',
      focus: 'Eye contact without effort',
      tip: 'Lie on your sides facing each other. It keeps things slow, close and easy to pause, and works well when energy is low.',
    },
    {
      name: 'Seated Hug',
      focus: 'Closeness and control',
      tip: 'Sitting on a bed edge or sofa with one partner on the other’s lap lets the person on top set the pace completely.',
    },
    {
      name: 'Towel and Tea',
      focus: 'Period-day prep',
      tip: 'A dark towel, wipes and a warm drink nearby take the worry out of period-day intimacy. Talk about flow and comfort first.',
    },
    {
      name: 'Warm Compress Cuddle',
      focus: 'Cramp relief and closeness',
      tip: 'Spoon with a warm (not hot) heat pad on the lower belly. Sometimes closeness without sex is exactly what is needed.',
    },
    {
      name: 'Back Massage Break',
      focus: 'Relaxing tense muscles',
      tip: 'Ten minutes of slow lower-back massage with a little oil can ease tension. Ask about pressure and keep checking in.',
    },
    {
      name: 'Bath Together',
      focus: 'Warmth and slowing down',
      tip: 'A warm bath or shower together can relax cramps and stress. Keep water comfortably warm and the mood unhurried.',
    },
    {
      name: 'Slow Dance',
      focus: 'Playful closeness',
      tip: 'Put on one song you both love and slow dance in the kitchen. Small, silly moments build closeness too.',
    },
    {
      name: 'Hand Hold Check-in',
      focus: 'Consent made simple',
      tip: 'Agree that a squeeze of the hand means “all good” and two squeezes means “let’s pause”. Easy to use, easy to honour.',
    },
    {
      name: 'Lazy Morning',
      focus: 'Low energy, high comfort',
      tip: 'Stay in bed, skip the plans and keep things gentle. Mornings can feel easier when hormones and energy are calmer.',
    },
    {
      name: 'Foot Rub Trade',
      focus: 'Giving and receiving care',
      tip: 'Take turns with a five-minute foot rub. Swapping roles keeps it equal and gives both of you a chance to relax.',
    },
    {
      name: 'Feather Light Touch',
      focus: 'Sensation without pressure',
      tip: 'Slow, light strokes along the arms or back can feel calming. Ask what feels nice and follow the answer.',
    },
    {
      name: 'Breathing Together',
      focus: 'Calm before closeness',
      tip: 'Lie close and match your breathing for a minute or two. It eases nerves and helps both of you feel present.',
    },
    {
      name: 'The Recliner',
      focus: 'Support for the hips and back',
      tip: 'Leaning back against a headboard with pillows keeps the pelvis relaxed. Adjust pillows until nothing feels strained.',
    },
    {
      name: 'Kneeling Support',
      focus: 'Stability and easy pauses',
      tip: 'A pillow under the knees protects joints and makes it easy to stop and shift. Change position whenever you like.',
    },
    {
      name: 'Side by Side Stories',
      focus: 'Emotional closeness',
      tip: 'Lie side by side and each share the best part of your week. Feeling heard is part of intimacy too.',
    },
    {
      name: 'Blanket Fort Night',
      focus: 'Playful comfort',
      tip: 'Build a cosy nest of blankets with snacks and a film. Low-key nights are perfect for tired or crampy days.',
    },
    {
      name: 'Gentle Stretch Duo',
      focus: 'Easing tight muscles',
      tip: 'Try a few gentle stretches together, like child’s pose and a seated twist. Stop at mild stretch, never pain.',
    },
    {
      name: 'Hair Play',
      focus: 'Soothing, simple touch',
      tip: 'A slow scalp massage or playing with hair is deeply relaxing for many people. Ask first and keep it gentle.',
    },
    {
      name: 'Slow Kiss Rule',
      focus: 'Taking your time',
      tip: 'Agree to keep things to kissing only for ten minutes. Slowing down often makes closeness feel more relaxed.',
    },
    {
      name: 'Shower Steam',
      focus: 'Warmth and privacy',
      tip: 'Warm steam can soothe cramps and tension. Use a non-slip mat and keep it about comfort, not performance.',
    },
    {
      name: 'Back to Chest',
      focus: 'Feeling held',
      tip: 'Sit between your partner’s legs, leaning back against their chest. It is cosy, supportive and easy to talk in.',
    },
    {
      name: 'Morning Compliments',
      focus: 'Building confidence',
      tip: 'Each share one thing you love about the other before getting up. Feeling appreciated makes closeness easier.',
    },
    {
      name: 'Ice and Heat',
      focus: 'Gentle contrast',
      tip: 'A warm hand and a cool glass of water within reach can be soothing. Keep temperature play mild and always ask first.',
    },
    {
      name: 'Pause Button',
      focus: 'Consent at any point',
      tip: 'Agree that either of you can pause anytime, no explanation needed, and that pausing is never a problem.',
    },
    {
      name: 'Pelvic Rest Day',
      focus: 'When pain says no',
      tip: 'If there is pelvic pain, choose cuddles, massage or a film instead. Pain during sex is worth mentioning to a doctor.',
    },
    {
      name: 'Aftercare Ritual',
      focus: 'Ending with care',
      tip: 'Finish with water, a cuddle and a quick “how was that for you?”. Gentle check-ins afterwards build trust.',
    },
  ],
};
