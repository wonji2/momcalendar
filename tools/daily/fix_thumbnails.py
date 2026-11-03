import os
import sys
import json
import urllib.request

SB_MGMT_TOKEN = os.environ.get('SUPABASE_TRIAGE_TOKEN') or os.environ.get('SUPABASE_MGMT_TOKEN')

FIX_THUMBNAILS = {
    1768: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/9718376800/B.jpg',
    1777: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/492842757/B.jpg',
    1735: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/9712622434/B.jpg',
    1761: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/9232893709/B.jpg',
    1753: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/7826121612/B.jpg',
    1721: 'https://cdn2.boribori.co.kr/cdn/product/A3437/P408089380/2_P408089380_basic_1782716837154.jpg',
    1696: 'https://cdn2.boribori.co.kr/cdn/product/A0001/P265013509/1_P265013509_basic_1782500000000.jpg',
    1698: 'https://cdn2.boribori.co.kr/cdn/product/A0001/P382322750/1_P382322750_basic_1782500000000.jpg',
    1724: 'https://contents.lotteon.com/itemimage/LO/27/65/45/12/93/LO2765451293_1_1.jpg',
    1812: 'https://thumbnail7.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/05/23/11/4/c089c25f-2c83-4a1e-a4b5-4122d25f7781.jpg',
    1814: 'https://thumbnail9.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/04/18/10/8/9f257bf4-3ff3-4ee1-b9bc-4df15a4d6501.jpg',
    1816: 'https://thumbnail10.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/09/25/14/6/17c823b1-2a65-4f76-8801-44755ad26cf8.jpg',
    1817: 'https://thumbnail6.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/06/12/17/2/6d1c8f42-4f10-4aa7-b50a-e83c072d670a.jpg',
    1808: 'https://thumbnail10.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2026/08/14/15/8/3e5cb159-22a7-47b2-a4e9-29177a58b88d.jpg',
    1719: 'https://sitem.ssgcdn.com/51/64/08/item/1000070864551_i1_500.jpg',
    1722: 'https://sitem.ssgcdn.com/32/38/13/item/1000813338532_i1_500.jpg',
    1712: 'https://sitem.ssgcdn.com/84/89/06/item/1000064098984_i1_500.jpg',
    1748: 'https://sitem.ssgcdn.com/79/68/34/item/1000834586879_i1_500.jpg',
    1745: 'https://sitem.ssgcdn.com/59/13/28/item/1000022801359_i1_500.jpg',
    1749: 'https://sitem.ssgcdn.com/58/36/61/item/1000796136658_i1_500.jpg',
    1750: 'https://sitem.ssgcdn.com/27/75/56/item/1000568275727_i1_500.jpg',
    1707: 'https://sitem.ssgcdn.com/01/27/67/item/1000677222701_i1_500.jpg',
    1507: 'https://image.hmall.com/p/image/broadcast/20261023/bfmt202610236004.jpg',
}

def run_sql(query):
    if not SB_MGMT_TOKEN:
        print('[ERROR] No SB_MGMT_TOKEN!')
        sys.exit(1)
    url = 'https://api.supabase.com/v1/projects/hycaqsqeogjtbscmzrtm/database/query'
    req = urllib.request.Request(
        url,
        data=json.dumps({'query': query}).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {SB_MGMT_TOKEN}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))

def main():
    print(f'Starting thumbnail fix for {len(FIX_THUMBNAILS)} hotdeals...')
    sqls = []
    for hid, img in FIX_THUMBNAILS.items():
        safe_img = img.replace("'", "''")
        sqls.append(f"UPDATE public.hotdeals SET img_url = '{safe_img}' WHERE id = {hid};")
    full_query = "\n".join(sqls)
    res = run_sql(full_query)
    print('DB Query Result:', res)

if __name__ == '__main__':
    main()
