import * as d3 from 'd3';

const csv = `SNo-NOT-UNIQUE,City,State,Location
1,New York,New York,?40.6643øN 73.9385øW
2,Los Angeles,California,?34.0194øN 118.4108øW
3,Chicago,Illinois,41.8376øN 87.6818øW
4,Houston,Texas,?29.7805øN 95.3863øW
5,Philadelphia,Pennsylvania,40.0094øN 75.1333øW
6,Phoenix,Arizona,33.5722øN 112.0880øW
7,San Antonio,Texas,29.4724øN 98.5251øW
8,San Diego,California,32.8153øN 117.1350øW
9,Dallas,Texas,32.7757øN 96.7967øW
10,San Jose,California,?37.2969øN 121.8193øW
11,Austin,Texas,?30.3072øN 97.7560øW
12,Indianapolis,Indiana,39.7767øN 86.1459øW
13,Jacksonville,Florida,30.3370øN 81.6613øW
14,San Francisco,California,37.7751øN 122.4193øW
15,Columbus,Ohio,39.9848øN 82.9850øW
16,Charlotte,North Carolina,35.2087øN 80.8307øW
17,Fort Worth,Texas,32.7795øN 97.3463øW
18,Detroit,Michigan,?42.3830øN 83.1022øW
19,El Paso,Texas,31.8484øN 106.4270øW
20,Memphis,Tennessee,?35.1035øN 89.9785øW
21,Seattle,Washington,?47.6205øN 122.3509øW
22,Denver,Colorado,?39.7618øN 104.8806øW
23,Washington,District of Columbia,?38.9041øN 77.0171øW
24,Boston,Massachusetts,42.3320øN 71.0202øW
25,Nashville,Tennessee,36.1718øN 86.7850øW
26,Baltimore,Maryland,39.3002øN 76.6105øW
27,Oklahoma City,Oklahoma,35.4671øN 97.5137øW
28,Louisville,Kentucky,?38.1781øN 85.6667øW
29,Portland,Oregon,45.5370øN 122.6500øW
30,Las Vegas,Nevada,36.2277øN 115.2640øW
31,Milwaukee,Wisconsin,?43.0633øN 87.9667øW
32,Albuquerque,New Mexico,35.1056øN 106.6474øW
33,Tucson,Arizona,32.1543øN 110.8711øW
34,Fresno,California,36.7827øN 119.7945øW
35,Sacramento,California,?38.5666øN 121.4686øW
36,Long Beach,California,33.8091øN 118.1553øW
37,Kansas City,Missouri,?39.1252øN 94.5511øW
38,Mesa,Arizona,?33.4019øN 111.7174øW
39,Virginia Beach,Virginia,?36.7793øN 76.0240øW
40,Atlanta,Georgia,?33.7629øN 84.4227øW
41,Colorado Springs,Colorado,38.8673øN 104.7607øW
42,Omaha,Nebraska,41.2647øN 96.0419øW
43,Raleigh,North Carolina,?35.8302øN 78.6414øW
44,Miami,Florida,25.7752øN 80.2086øW
45,Oakland,California,37.7699øN 122.2256øW
46,Minneapolis,Minnesota,44.9633øN 93.2683øW
47,Tulsa,Oklahoma,?36.1279øN 95.9023øW
48,Cleveland,Ohio,41.4781øN 81.6795øW
49,Wichita,Kansas,?37.6907øN 97.3427øW
50,Arlington,Texas,?32.7007øN 97.1247øW
51,New Orleans,Louisiana,30.0686øN 89.9390øW
52,Bakersfield,California,35.3212øN 119.0183øW
53,Tampa,Florida,27.9701øN 82.4797øW
54,Honolulu,Hawai'i,21.3259øN 157.8453øW
55,Aurora,Colorado,?39.7082øN 104.8235øW
56,Anaheim,California,33.8555øN 117.7601øW
57,Santa Ana,California,33.7365øN 117.8826øW
58,St. Louis,Missouri,?38.6357øN 90.2446øW
59,Riverside,California,?33.9381øN 117.3932øW
60,Corpus Christi,Texas,?27.7543øN 97.1734øW
61,Lexington,Kentucky,?38.0402øN 84.4584øW
62,Pittsburgh,Pennsylvania,?40.4398øN 79.9766øW
63,Anchorage,Alaska,?61.2176øN 149.8953øW
64,Stockton,California,?37.9763øN 121.3133øW
65,Cincinnati,Ohio,?39.1399øN 84.5064øW
66,Saint Paul,Minnesota,?44.9489øN 93.1039øW
67,Toledo,Ohio,?41.6641øN 83.5819øW
68,Greensboro,North Carolina,?36.0965øN 79.8271øW
69,Newark,New Jersey,?40.7242øN 74.1726øW
70,Plano,Texas,?33.0508øN 96.7479øW
71,Henderson,Nevada,?36.0122øN 115.0375øW
72,Lincoln,Nebraska,?40.8090øN 96.6804øW
73,Buffalo,New York,?42.8925øN 78.8597øW
74,Jersey City,New Jersey,?40.7114øN 74.0648øW
75,Chula Vista,California,?32.6277øN 117.0152øW
76,Fort Wayne,Indiana,?41.0882øN 85.1439øW
77,Orlando,Florida,?28.4159øN 81.2988øW
78,St. Petersburg,Florida,?27.7620øN 82.6441øW
79,Chandler,Arizona,?33.2829øN 111.8549øW
80,Laredo,Texas,?27.5477øN 99.4869øW
81,Norfolk,Virginia,?36.9230øN 76.2446øW
82,Durham,North Carolina,?35.9810øN 78.9056øW
83,Madison,Wisconsin,?43.0878øN 89.4301øW
84,Lubbock,Texas,?33.5665øN 101.8867øW
85,Irvine,California,?33.6784øN 117.7713øW
86,Winston?Salem,North Carolina,?36.1033øN 80.2606øW
87,Glendale,Arizona,?33.5331øN 112.1899øW
88,Garland,Texas,?32.9098øN 96.6304øW
89,Hialeah,Florida,?25.8699øN 80.3029øW
90,Reno,Nevada,?39.4745øN 119.7765øW
91,Chesapeake,Virginia,?36.6794øN 76.3018øW
92,Gilbert,Arizona,?33.3102øN 111.7422øW
93,Baton Rouge,Louisiana,?30.4485øN 91.1259øW
94,Irving,Texas,?32.8577øN 96.9700øW
95,Scottsdale,Arizona,?33.6687øN 111.8237øW
96,North Las Vegas,Nevada,?36.2830øN 115.0893øW
97,Fremont,California,?37.4944øN 121.9411øW
98,Boise,Idaho,?43.5985øN 116.2311øW
99,Richmond,Virginia,?37.5314øN 77.4760øW
100,San Bernardino,California,?34.1393øN 117.2953øW
101,Birmingham,Alabama,?33.5274øN 86.7990øW
102,Spokane,Washington,?47.6736øN 117.4166øW
103,Rochester,New York,?43.1699øN 77.6169øW
104,Des Moines,Iowa,?41.5739øN 93.6167øW
105,Modesto,California,?37.6609øN 120.9891øW
106,Fayetteville,North Carolina,?35.0851øN 78.9803øW
107,Tacoma,Washington,?47.2522øN 122.4598øW
108,Oxnard,California,?34.2023øN 119.2046øW
109,Fontana,California,?34.1088øN 117.4627øW
110,Columbus,Georgia,?32.5102øN 84.8749øW
111,Montgomery,Alabama,?32.3463øN 86.2686øW
112,Moreno Valley,California,?33.9233øN 117.2057øW
113,Shreveport,Louisiana,?32.4670øN 93.7927øW
114,Aurora,Illinois,?41.7635øN 88.2901øW
115,Yonkers,New York,?40.9459øN 73.8674øW
116,Akron,Ohio,?41.0805øN 81.5214øW
117,Huntington Beach,California,?33.6906øN 118.0093øW
118,Little Rock,Arkansas,?34.7254øN 92.3586øW
119,Augusta,Georgia,?33.3655øN 82.0734øW
120,Amarillo,Texas,?35.1978øN 101.8287øW
121,Glendale,California,?34.1814øN 118.2458øW
122,Mobile,Alabama,?30.6684øN 88.1002øW
123,Grand Rapids,Michigan,?42.9612øN 85.6556øW
124,Salt Lake City,Utah,?40.7785øN 111.9314øW
125,Tallahassee,Florida,?30.4551øN 84.2534øW
126,Huntsville,Alabama,?34.7843øN 86.5390øW
127,Grand Prairie,Texas,?32.6842øN 97.0210øW
128,Knoxville,Tennessee,?35.9709øN 83.9465øW
129,Worcester,Massachusetts,?42.2695øN 71.8078øW
130,Newport News,Virginia,?37.0760øN 76.5217øW
131,Brownsville,Texas,?26.0183øN 97.4538øW
132,Overland Park,Kansas,?38.8890øN 94.6906øW
133,Santa Clarita,California,?34.4049øN 118.5047øW
134,Providence,Rhode Island,?41.8231øN 71.4188øW
135,Garden Grove,California,?33.7788øN 117.9605øW
136,Chattanooga,Tennessee,?35.0665øN 85.2471øW
137,Oceanside,California,?33.2246øN 117.3062øW
138,Jackson,Mississippi,?32.3158øN 90.2128øW
139,Fort Lauderdale,Florida,?26.1413øN 80.1439øW
140,Santa Rosa,California,?38.4468øN 122.7061øW
141,Rancho Cucamonga,California,?34.1233øN 117.5642øW
142,Port St. Lucie,Florida,?27.2810øN 80.3838øW
143,Tempe,Arizona,?33.3884øN 111.9318øW
144,Ontario,California,?34.0395øN 117.6088øW
145,Vancouver,Washington,?45.6372øN 122.5965øW
146,Cape Coral,Florida,?26.6431øN 81.9973øW
147,Sioux Falls,South Dakota,?43.5383øN 96.7320øW
148,Springfield,Missouri,?37.1942øN 93.2913øW
149,Peoria,Arizona,?33.7877øN 112.3111øW
150,Pembroke Pines,Florida,?26.0212øN 80.3404øW
151,Elk Grove,California,?38.4144øN 121.3849øW
152,Salem,Oregon,?44.9237øN 123.0231øW
153,Lancaster,California,?34.6936øN 118.1753øW
154,Corona,California,?33.8624øN 117.5639øW
155,Eugene,Oregon,?44.0567øN 123.1162øW
156,Palmdale,California,?34.5913øN 118.1090øW
157,Salinas,California,?36.6902øN 121.6337øW
158,Springfield,Massachusetts,?42.1155øN 72.5400øW
159,Pasadena,Texas,?29.6583øN 95.1505øW
160,Fort Collins,Colorado,?40.5482øN 105.0648øW
161,Hayward,California,?37.6281øN 122.1063øW
162,Pomona,California,?34.0586øN 117.7613øW
163,Cary,North Carolina,?35.7821øN 78.8141øW
164,Rockford,Illinois,?42.2634øN 89.0628øW
165,Alexandria,Virginia,?38.8183øN 77.0820øW
166,Escondido,California,?33.1336øN 117.0732øW
167,McKinney,Texas,?33.2012øN 96.6680øW
168,Kansas City,Kansas,?39.1225øN 94.7418øW
169,Joliet,Illinois,?41.5181øN 88.1584øW
170,Sunnyvale,California,?37.3858øN 122.0263øW
171,Torrance,California,?33.8350øN 118.3414øW
172,Bridgeport,Connecticut,?41.1874øN 73.1957øW
173,Lakewood,Colorado,?39.6989øN 105.1176øW
174,Hollywood,Florida,?26.0311øN 80.1646øW
175,Paterson,New Jersey,?40.9147øN 74.1628øW
176,Naperville,Illinois,?41.7492øN 88.1620øW
177,Syracuse,New York,?43.0410øN 76.1436øW
178,Mesquite,Texas,?32.7639øN 96.5924øW
179,Dayton,Ohio,?39.7774øN 84.1996øW
180,Savannah,Georgia,?32.0025øN 81.1536øW
181,Clarksville,Tennessee,?36.5664øN 87.3452øW
182,Orange,California,?33.8048øN 117.8249øW
183,Pasadena,California,?34.1606øN 118.1396øW
184,Fullerton,California,?33.8857øN 117.9280øW
185,Killeen,Texas,?31.0777øN 97.7320øW
186,Frisco,Texas,?33.1510øN 96.8193øW
187,Hampton,Virginia,?37.0480øN 76.2971øW
188,McAllen,Texas,?26.2185øN 98.2461øW
189,Warren,Michigan,?42.4929øN 83.0250øW
190,Bellevue,Washington,?47.5978øN 122.1565øW
191,West Valley City,Utah,?40.6885øN 112.0118øW
192,Columbia,South Carolina,?34.0298øN 80.8966øW
193,Olathe,Kansas,?38.8843øN 94.8188øW
194,Sterling Heights,Michigan,?42.5812øN 83.0303øW
195,New Haven,Connecticut,?41.3108øN 72.9250øW
196,Miramar,Florida,?25.9770øN 80.3358øW
197,Waco,Texas,?31.5601øN 97.1860øW
198,Thousand Oaks,California,?34.1933øN 118.8742øW
199,Cedar Rapids,Iowa,?41.9670øN 91.6778øW
200,Charleston,South Carolina,?32.8179øN 79.9589øW
201,Visalia,California,?36.3272øN 119.3234øW
202,Topeka,Kansas,?39.0362øN 95.6948øW
203,Elizabeth,New Jersey,?40.6663øN 74.1935øW
204,Gainesville,Florida,?29.6788øN 82.3459øW
205,Thornton,Colorado,?39.9180øN 104.9454øW
206,Roseville,California,?38.7657øN 121.3032øW
207,Carrollton,Texas,?32.9884øN 96.8998øW
208,Coral Springs,Florida,?26.2708øN 80.2593øW
209,Stamford,Connecticut,?41.0799øN 73.5460øW
210,Simi Valley,California,?34.2669øN 118.7485øW
211,Concord,California,?37.9722øN 122.0016øW
212,Hartford,Connecticut,?41.7660øN 72.6833øW
213,Kent,Washington,?47.3853øN 122.2169øW
214,Lafayette,Louisiana,?30.2116øN 92.0314øW
215,Midland,Texas,?32.0299øN 102.1097øW
216,Surprise,Arizona,?33.6706øN 112.4527øW
217,Denton,Texas,?33.2151øN 97.1417øW
218,Victorville,California,?34.5277øN 117.3536øW
219,Evansville,Indiana,?37.9877øN 87.5347øW
220,Santa Clara,California,?37.3646øN 121.9679øW
221,Abilene,Texas,?32.4545øN 99.7381øW
222,Athens,Georgia,?33.9496øN 83.3701øW
223,Vallejo,California,?38.1079øN 122.2639øW
224,Allentown,Pennsylvania,?40.5940øN 75.4782øW
225,Norman,Oklahoma,?35.2406øN 97.3453øW
226,Beaumont,Texas,?30.0843øN 94.1458øW
227,Independence,Missouri,?39.0853øN 94.3513øW
228,Murfreesboro,Tennessee,?35.8522øN 86.4161øW
229,Ann Arbor,Michigan,?42.2756øN 83.7313øW
230,Springfield,Illinois,?39.7639øN 89.6708øW
231,Berkeley,California,?37.8667øN 122.2991øW
232,Peoria,Illinois,?40.7523øN 89.6171øW
233,Provo,Utah,?40.2453øN 111.6448øW
234,El Monte,California,?34.0746øN 118.0291øW
235,Columbia,Missouri,?38.9479øN 92.3261øW
236,Lansing,Michigan,?42.7098øN 84.5562øW
237,Fargo,North Dakota,?46.8652øN 96.8290øW
238,Downey,California,?33.9382øN 118.1309øW
239,Costa Mesa,California,?33.6659øN 117.9123øW
240,Wilmington,North Carolina,?34.2092øN 77.8858øW
241,Arvada,Colorado,?39.8097øN 105.1066øW
242,Inglewood,California,?33.9561øN 118.3443øW
243,Miami Gardens,Florida,?25.9489øN 80.2436øW
244,Carlsbad,California,?33.1239øN 117.2828øW
245,Westminster,Colorado,?39.8822øN 105.0644øW
246,Rochester,Minnesota,?44.0154øN 92.4772øW
247,Odessa,Texas,?31.8804øN 102.3434øW
248,Manchester,New Hampshire,?42.9847øN 71.4439øW
249,Elgin,Illinois,?42.0396øN 88.3217øW
250,West Jordan,Utah,?40.6023øN 112.0010øW
251,Round Rock,Texas,?30.5237øN 97.6674øW
252,Clearwater,Florida,?27.9795øN 82.7663øW
253,Waterbury,Connecticut,?41.5585øN 73.0367øW
254,Gresham,Oregon,?45.5023øN 122.4416øW
255,Fairfield,California,?38.2568øN 122.0397øW
256,Billings,Montana,?45.7895øN 108.5499øW
257,Lowell,Massachusetts,?42.6389øN 71.3221øW
258,Ventura,California,?34.2681øN 119.2550øW
259,Pueblo,Colorado,?38.2731øN 104.6124øW
260,High Point,North Carolina,?35.9855øN 79.9902øW
261,West Covina,California,?34.0559øN 117.9099øW
262,Richmond,California,?37.9530øN 122.3594øW
263,Murrieta,California,?33.5719øN 117.1907øW
264,Cambridge,Massachusetts,?42.3760øN 71.1183øW
265,Antioch,California,?37.9775øN 121.7976øW
266,Temecula,California,?33.5019øN 117.1246øW
267,Norwalk,California,?33.9069øN 118.0834øW
268,Centennial,Colorado,?39.5906øN 104.8691øW
269,Everett,Washington,?48.0033øN 122.1742øW
270,Palm Bay,Florida,?27.9856øN 80.6626øW
271,Wichita Falls,Texas,?33.9067øN 98.5259øW
272,Green Bay,Wisconsin,?44.5207øN 87.9842øW
273,Daly City,California,?37.7009øN 122.4650øW
274,Burbank,California,?34.1890øN 118.3249øW
275,Richardson,Texas,?32.9723øN 96.7081øW
276,Pompano Beach,Florida,?26.2426øN 80.1290øW
277,North Charleston,South Carolina,?32.8853øN 80.0169øW
278,Broken Arrow,Oklahoma,?36.0365øN 95.7810øW
279,Boulder,Colorado,?40.0175øN 105.2797øW
280,West Palm Beach,Florida,?26.7483øN 80.1266øW
281,Santa Maria,California,?34.9332øN 120.4438øW
282,El Cajon,California,?32.8017øN 116.9605øW
283,Davenport,Iowa,?41.5541øN 90.6040øW
284,Rialto,California,?34.1118øN 117.3883øW
285,Edison,New Jersey,?40.5039917øN 74.3494111øW
286,Las Cruces,New Mexico,?32.3197øN 106.7653øW
287,San Mateo,California,?37.5542øN 122.3131øW
288,Lewisville,Texas,?33.0383øN 97.0061øW
289,South Bend,Indiana,?41.6769øN 86.2690øW
290,Lakeland,Florida,?28.0411øN 81.9589øW
291,Erie,Pennsylvania,?42.1166øN 80.0735øW
292,Woodbridge,New Jersey,?40.56075øN 74.29262øW
293,Tyler,Texas,?32.35øN 95.30øW
294,Pearland,Texas,?29.5544øN 95.2958øW
295,College Station,Texas,?30.6013øN 96.3144øW
1,San Juan,Puerto Rico,?18.4064øN 66.0640øW,
2,Bayam¢n,Puerto Rico,?18.3801øN 66.1633øW,
3,Carolina,Puerto Rico,?18.4121øN 65.9798øW,
4,Ponce,Puerto Rico,?17.9874øN 66.6097øW,
5,Caguas,Puerto Rico,?18.2324øN 66.0390øW,
1,Paradise,Nevada,?36.08073øN 115.1368øW
2,Arlington,Virginia,?38.880øN 77.183øW
3,Sunrise Manor,Nevada,?36.1785øN 115.0490øW
4,Spring Valley,Nevada,?36.0987øN 115.2619øW
5,Metairie,Louisiana,?29.9978øN 90.1779øW
6,East Los Angeles,California,?34.0315øN 118.1686øW
7,Enterprise,Nevada,?36.0182øN 115.2154øW
8,Brandon,Florida,?27.9360øN 82.2993øW`;

export function buildGeocoder() {
	const map = {};
	const rows = d3.csvParse(csv);
	rows.forEach(row => {
		const key = row['City'].toLowerCase()];

		// whack formatting
		const [lat, lon] = row['Location'].slice(1).split(' ');
		const latBits = lat.split('ø');
		const lonBits = lon.split('ø');
		map[key] = {
			lat: +latBits[0] * (latBits[1] === 'S' ? -1 : 1),
			lon: +lonBits[0] * (lonBits[1] === 'W' ? -1 : 1)
		};
	});
	return map;
}