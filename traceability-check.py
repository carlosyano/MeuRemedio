#!/usr/bin/env python3
from pathlib import Path
from hashlib import sha256
import sys, yaml, json
from jsonschema import Draft202012Validator

def fail(code,msg,errors): errors.append({'code':code,'message':msg})
def main():
    if len(sys.argv)!=3:
        print('Usage: python traceability-check.py MATRIX OPENAPI',file=sys.stderr); return 2
    mp=Path(sys.argv[1]); op=Path(sys.argv[2]); base=mp.parent
    m=yaml.safe_load(mp.read_text(encoding='utf-8')); api=yaml.safe_load(op.read_text(encoding='utf-8'))
    schema=json.loads((base/'traceability-matrix.schema.json').read_text(encoding='utf-8')); errors=[]
    for e in Draft202012Validator(schema).iter_errors(m): fail('schema-error',f"{'/'.join(map(str,e.absolute_path))}: {e.message}",errors)
    for name,rec in m.get('generated_from',{}).get('source_integrity',{}).get('artifacts',{}).items():
        p=base/rec['file']
        if not p.exists(): fail('source-file-missing',f'{name}: {p.name}',errors); continue
        actual=sha256(p.read_bytes()).hexdigest()
        if actual!=rec['sha256']: fail('source-hash-mismatch',f'{name}: expected {rec["sha256"]}, got {actual}',errors)
    api_ops={}; private=[]
    for path,item in api['paths'].items():
        for method,v in item.items():
            if method.lower() not in {'get','post','put','delete','patch','head','options','trace'}: continue
            oid=v.get('operationId')
            if not oid: fail('missing-operation-id',f'{method.upper()} {path}',errors); continue
            if oid in api_ops: fail('duplicate-operation-id',oid,errors)
            api_ops[oid]=(method.upper(),path,v)
            if v.get('security')!=[]: private.append(oid)
    if set(api_ops)!=set(m.get('operations',{})): fail('operation-catalog-mismatch',f'openapi_only={sorted(set(api_ops)-set(m.get("operations",{})))} matrix_only={sorted(set(m.get("operations",{}))-set(api_ops))}',errors)
    # Exact catalog checks
    for name,rec in m.get('catalog_completeness',{}).items():
        exp=set(rec.get('expected_ids',[])); act=set(rec.get('actual_ids',[])); live=set(m.get(name,{}))
        if exp!=act or act!=live: fail('catalog-mismatch',f'{name}: expected={sorted(exp)} actual={sorted(act)} live={sorted(live)}',errors)
    # Source views must match live primary catalogs.
    pairs={'requirements_source':'requirements','non_functional_requirements_source':'non_functional_requirements','acceptance_criteria_source':'acceptance_criteria','errors_source':'errors','sentinel_tests_source':'sentinel_tests','production_gates_source':'production_gates'}
    for src,dst in pairs.items():
        if set(m.get('source_catalogs',{}).get(src,{}))!=set(m.get(dst,{})): fail('source-catalog-mismatch',f'{src} vs {dst}',errors)
    known=set().union(*(set(m.get(k,{})) for k in ['requirements','non_functional_requirements','acceptance_criteria','sentinel_tests','business_rules','entities','flows','screen_states','user_stories','decisions','approved_questions']))
    for oid,(_,_,v) in api_ops.items():
        for ref in v.get('x-traceability',[]):
            if ref not in known: fail('unknown-reference',f'{oid}: {ref}',errors)
    for oid in private:
        own=m.get('operations',{}).get(oid,{}).get('ownership_test')
        if not own or not own.get('required') or 'TS-023' not in own.get('sentinel_tests',[]): fail('missing-ownership-test',oid,errors)
    for tid,rec in m.get('sentinel_tests',{}).items():
        if not rec.get('test_artifacts'): fail('missing-test-artifact',tid,errors)
    result={'status':'PASS' if not errors else 'FAIL','errors':errors,'counts':{k:len(m.get(k,{})) for k in ['requirements','non_functional_requirements','business_rules','entities','flows','screen_states','user_stories','acceptance_criteria','errors','sentinel_tests','decisions','approved_questions','production_gates','operations']}}
    print(json.dumps(result,ensure_ascii=False,indent=2)); return 0 if not errors else 1
if __name__=='__main__': sys.exit(main())
