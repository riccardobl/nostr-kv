
export default class Utils {
    static fastId(value) {
        value=value.toString();
        value =  Buffer.from(value).toString('base64');
        return value;
    }

}